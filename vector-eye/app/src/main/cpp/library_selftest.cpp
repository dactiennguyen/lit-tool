// Isolated test of the actual production callback and the installed library.
#include "module.cpp"
#include <cstdio>

int main(int argc, char **argv) {
    if (argc != 2) { std::puts("usage: eye_library_selftest /path/libliteye.so"); return 1; }
    void *handle = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    if (!handle) { std::printf("dlopen failed: %s\n", dlerror()); return 2; }
    OnLoaded onload = native_init(nullptr);
    onload(argv[1], handle);
    if (!base) { std::puts("library base not found"); return 3; }
    for (const auto &s : sites) {
        const auto *code = reinterpret_cast<const uint32_t *>(base + s.offset);
        if (memcmp(code, s.insns, sizeof(s.insns))) {
            std::printf("%s: disabled inline site was modified\n", s.name); return 4;
        }
        uint8_t object[32] = {};
        uint8_t str[24] = {};
        object[0] = 3;
        *reinterpret_cast<uint8_t **>(object + 8) = str;
        str[0] = static_cast<uint8_t>(strlen(s.from) * 2);
        memcpy(str + 1, s.from, strlen(s.from));
        RegisterContext ctx{};
        ctx.general.regs.x0 = reinterpret_cast<uintptr_t>(object);
        HookEntryInfo info{};
        info.instruction_address = reinterpret_cast<void *>(base + s.offset);
        instrument(&ctx, &info);
        if (memcmp(str + 1, s.to, strlen(s.to))) {
            std::printf("%s: callback mismatch\n", s.name); return 5;
        }
        std::printf("%s: inline site unchanged; callback changed expected value\n", s.name);
    }
    puts("PASS: inline sites remain unmodified; callbacks tested on synthetic data");
    return 0;
}
