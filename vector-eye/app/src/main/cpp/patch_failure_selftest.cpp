#include "dobby.h"
#include <cerrno>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <sys/mman.h>
#include <unistd.h>

extern "C" int __real_mprotect(void *, size_t, int);
static uintptr_t deny_page;
extern "C" int __wrap_mprotect(void *addr, size_t size, int prot) {
    if (reinterpret_cast<uintptr_t>(addr) == deny_page && (prot & PROT_WRITE)) {
        errno = EACCES;
        return -1;
    }
    return __real_mprotect(addr, size, prot);
}

extern "C" __attribute__((noinline)) int test_target(int x) { return x + 1; }
static void callback(RegisterContext *, const HookEntryInfo *) {}
static int replacement(int x) { return x + 2; }

int main() {
    const auto addr = reinterpret_cast<uintptr_t>(&test_target);
    const auto page_size = static_cast<uintptr_t>(sysconf(_SC_PAGESIZE));
    uint8_t original[16];
    memcpy(original, reinterpret_cast<void *>(addr), sizeof(original));
    deny_page = addr & ~(page_size - 1);
    int instrument = DobbyInstrument(reinterpret_cast<void *>(addr), callback);
    if (instrument == 0 || memcmp(original, reinterpret_cast<void *>(addr), sizeof(original)) || test_target(4) != 5) {
        puts("FAIL: instrumentation did not report failure or altered target"); return 1;
    }
    void *orig = nullptr;
    int hook = DobbyHook(reinterpret_cast<void *>(addr), reinterpret_cast<void *>(replacement), &orig);
    if (hook == 0 || memcmp(original, reinterpret_cast<void *>(addr), sizeof(original)) || test_target(4) != 5) {
        puts("FAIL: hook did not report failure or altered target"); return 2;
    }
    deny_page = 0;
    if (DobbyInstrument(reinterpret_cast<void *>(addr), callback) != 0 || test_target(4) != 5 ||
        DobbyDestroy(reinterpret_cast<void *>(addr)) != 0 ||
        memcmp(original, reinterpret_cast<void *>(addr), sizeof(original))) {
        puts("FAIL: retry after denied write did not install and restore"); return 3;
    }
    puts("PASS: denied writes reported; retry installed and restored");
    return 0;
}
