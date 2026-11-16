// Standalone diagnostics only: never installed into the app process.
#include "module.cpp"
#include <cstdio>
#include <cstdlib>

static bool executable(uintptr_t address) {
    FILE *maps = fopen("/proc/self/maps", "r");
    if (!maps) return false;
    char *line = nullptr; size_t capacity = 0; bool result = false;
    while (getline(&line, &capacity, maps) > 0) {
        unsigned long long start = 0, end = 0; char permissions[5] = {};
        if (sscanf(line, "%llx-%llx %4s", &start, &end, permissions) == 3 &&
                address >= start && address < end) { result = permissions[2] == 'x'; break; }
    }
    free(line); fclose(maps); return result;
}

int main(int argc, char **argv) {
    if (argc != 2) { puts("usage: eye_trampoline_map_selftest /path/libliteye.so"); return 1; }
    void *handle = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    if (!handle) { printf("dlopen failed: %s\n", dlerror()); return 2; }
    void *entry = dlsym(handle, "JNI_OnLoad"); Dl_info info{};
    if (!entry || !dladdr(entry, &info) || !info.dli_fbase) return 3;
    base = reinterpret_cast<uintptr_t>(info.dli_fbase);
    if (reinterpret_cast<uintptr_t>(entry) - base != 0xb2cf4) return 4;
    dobby_enable_near_branch_trampoline();
    unsigned installed = 0; int result = 0;
    for (const auto &s : sites) {
        auto *code = reinterpret_cast<uint32_t *>(base + s.offset);
        if (memcmp(code, s.insns, sizeof(s.insns)) != 0 || DobbyInstrument(code, instrument) != 0) {
            printf("%s: could not install\n", s.name); result = 5; break;
        }
        ++installed;
        uint32_t branch = code[0];
        if ((branch & 0xfc000000u) != 0x14000000u || memcmp(code + 1, s.insns + 1, 12)) {
            printf("%s: not a single B instruction\n", s.name); result = 6; break;
        }
        int64_t displacement = static_cast<int64_t>(static_cast<int32_t>(branch << 6) >> 4);
        uintptr_t destination = reinterpret_cast<uintptr_t>(code) + displacement;
        bool has_exec = executable(destination);
        printf("%s: branch target %s\n", s.name, has_exec ? "executable" : "NOT executable");
        if (!has_exec) { result = 7; break; }
    }
    for (unsigned i = 0; i < installed; i++) {
        auto *address = reinterpret_cast<void *>(base + sites[i].offset);
        if (DobbyDestroy(address) != 0 || memcmp(address, sites[i].insns, sizeof(sites[i].insns))) {
            printf("%s: restore failed\n", sites[i].name); result = 8;
        }
    }
    if (!result && installed == sizeof(sites) / sizeof(sites[0]))
        puts("PASS: branch targets executable immediately after installation; sites restored");
    dlclose(handle); return result;
}
