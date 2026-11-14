#include "dobby.h"
#include <cstdint>
#include <cstdio>
#include <cstring>

extern "C" void run_site(uint8_t *object);
extern "C" void hook_site();
asm(
    ".text\n"
    ".p2align 4\n"
    ".global run_site\n"
    "run_site:\n"
    "mov w10, wzr\n"
    ".global hook_site\n"
    "hook_site:\n"
    "tbz w10, #0, 1f\n"
    "nop\n"
    "nop\n"
    "1: nop\n"
    "ret\n"
);

static unsigned called;
static void callback(RegisterContext *ctx, const HookEntryInfo *) {
    auto *object = reinterpret_cast<uint8_t *>(ctx->general.regs.x0);
    if (!object || object[0] != 3) return;
    auto *str = object + 8;
    if (str[0] & 1) return;
    const size_t len = str[0] >> 1;
    if (len == 1 && str[1] == '1') str[1] = '0';
    else if (len == 1 && str[1] == '0') str[1] = '1';
    else if (len == 7 && memcmp(str + 1, "running", 7) == 0) memcpy(str + 1, "stopped", 7);
    else return;
    ++called;
}

int main() {
    uint32_t original[4];
    memcpy(original, reinterpret_cast<void *>(hook_site), sizeof(original));
    dobby_enable_near_branch_trampoline();
    if (DobbyInstrument(reinterpret_cast<void *>(hook_site), callback) != 0) {
        puts("instrument failed"); return 1;
    }
    if (memcmp(reinterpret_cast<const uint8_t *>(hook_site) + 4, original + 1, 12)) {
        DobbyDestroy(reinterpret_cast<void *>(hook_site));
        puts("unsafe long trampoline"); return 4;
    }
    const char *before[] = {"1", "0", "running", "1", "other"};
    const char *after[] = {"0", "1", "stopped", "0", "other"};
    for (unsigned i = 0; i < 5; ++i) {
        uint8_t object[32] = {};
        object[0] = 3;
        object[8] = static_cast<uint8_t>(strlen(before[i]) * 2);
        memcpy(object + 9, before[i], strlen(before[i]));
        run_site(object);
        if (memcmp(object + 9, after[i], strlen(after[i])) != 0) {
            std::printf("case %u failed\n", i); return 2;
        }
    }
    if (called != 4) { std::printf("unexpected callbacks: %u\n", called); return 3; }
    std::puts("PASS: 4 values changed; unexpected value preserved");
    return 0;
}
