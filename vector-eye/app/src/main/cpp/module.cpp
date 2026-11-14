#include <android/log.h>
#include <dlfcn.h>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <jni.h>
#include <sys/system_properties.h>
#include <media/NdkMediaDrm.h>
#include <sys/mman.h>
#include <unistd.h>
#include <array>
#include "dobby.h"

#define LOG(...) __android_log_print(ANDROID_LOG_INFO, "VectorEye", __VA_ARGS__)
using OnLoaded = void (*)(const char *, void *);
struct NativeAPIEntries { uint32_t version; void *hook_func; void *unhook_func; };

struct Site {
    uintptr_t offset;
    const char *name;
    const char *from;
    const char *to;
    uint32_t insns[4];
};
static const Site sites[] = {
    {0xe7e6c, "dual_app", "1", "0", {0x3600006a, 0xf95237e0, 0x97fefcfa, 0x91002280}},
    {0xf1af0, "installed_from_google", "0", "1", {0x3600006a, 0xf9500be0, 0x97fed5d9, 0x91002280}},
    {0xfdaf8, "init_svc_adbd", "running", "stopped", {0x3600006a, 0xf94b8fe0, 0x97fea5d7, 0x91002280}},
    {0xfff88, "is_adb_enabled", "1", "0", {0x3600006a, 0xf94a07e0, 0x97fe9cb3, 0x91002280}},
};
static uintptr_t base;
static std::mutex lock;
static bool attempted;
static JavaVM *java_vm;
static int (*original_property_get)(const char *, char *);
static thread_local bool reading_build_property;
static thread_local bool reading_drm;
static thread_local std::array<uint8_t, 256> drm_copy;
static media_status_t (*original_drm_get)(AMediaDrm *, const char *, AMediaDrmByteArray *);

// Only replace reads made by this exact native library. Other libraries and
// the actual Android system property continue to use the original value.
static int property_get(const char *name, char *value) {
    int result = original_property_get(name, value);
    if (!name || !value || reading_build_property || !java_vm)
        return result;
    const char *field_name = nullptr;
    if (!strcmp(name, "ro.product.model")) field_name = "MODEL";
    else if (!strcmp(name, "ro.product.brand")) field_name = "BRAND";
    else if (!strcmp(name, "ro.product.manufacturer")) field_name = "MANUFACTURER";
    else return result;
    Dl_info caller{};
    if (!dladdr(__builtin_return_address(0), &caller) ||
        reinterpret_cast<uintptr_t>(caller.dli_fbase) != base) return result;

    reading_build_property = true;
    JNIEnv *env = nullptr;
    bool attached = false;
    jint state = java_vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6);
    if (state == JNI_EDETACHED) {
        state = java_vm->AttachCurrentThread(&env, nullptr);
        attached = state == JNI_OK;
    }
    if (state == JNI_OK && env) {
        jclass build = env->FindClass("android/os/Build");
        jfieldID field = build ? env->GetStaticFieldID(build, field_name, "Ljava/lang/String;") : nullptr;
        jstring property = field ? static_cast<jstring>(env->GetStaticObjectField(build, field)) : nullptr;
        const char *text = property ? env->GetStringUTFChars(property, nullptr) : nullptr;
        if (text) {
            size_t length = strlen(text);
            if (length > 0 && length < PROP_VALUE_MAX) {
                memcpy(value, text, length + 1);
                result = static_cast<int>(length);
                LOG("%s synchronized with Build.%s", name, field_name);
            } else LOG("%s skipped: invalid length", name);
            env->ReleaseStringUTFChars(property, text);
        }
        if (env->ExceptionCheck()) { env->ExceptionClear(); LOG("%s skipped: JNI error", name); }
        if (property) env->DeleteLocalRef(property);
        if (build) env->DeleteLocalRef(build);
    }
    if (attached) java_vm->DetachCurrentThread();
    reading_build_property = false;
    return result;
}

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *) {
    java_vm = vm;
    return JNI_VERSION_1_6;
}

static media_status_t drm_get(AMediaDrm *drm, const char *name, AMediaDrmByteArray *out) {
    media_status_t result = original_drm_get(drm, name, out);
    if (result != 0 || !name || strcmp(name, "deviceUniqueId") || !out || reading_drm || !java_vm)
        return result;
    reading_drm = true;
    JNIEnv *env = nullptr;
    bool attached = false;
    jint state = java_vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6);
    if (state == JNI_EDETACHED) { state = java_vm->AttachCurrentThread(&env, nullptr); attached = state == JNI_OK; }
    if (state == JNI_OK && env && !env->ExceptionCheck()) {
        jclass uuid_class = nullptr, drm_class = nullptr;
        jstring uuid_text = nullptr, property = nullptr;
        jobject uuid = nullptr, java_drm = nullptr;
        jbyteArray bytes = nullptr;
        jmethodID release = nullptr;
        do {
            uuid_class = env->FindClass("java/util/UUID");
            if (!uuid_class || env->ExceptionCheck()) break;
            drm_class = env->FindClass("android/media/MediaDrm");
            if (!drm_class || env->ExceptionCheck()) break;
            jmethodID from_string = env->GetStaticMethodID(uuid_class, "fromString", "(Ljava/lang/String;)Ljava/util/UUID;");
            jmethodID ctor = env->GetMethodID(drm_class, "<init>", "(Ljava/util/UUID;)V");
            jmethodID get = env->GetMethodID(drm_class, "getPropertyByteArray", "(Ljava/lang/String;)[B");
            release = env->GetMethodID(drm_class, "release", "()V");
            if (env->ExceptionCheck() || !from_string || !ctor || !get || !release) break;
            uuid_text = env->NewStringUTF("edef8ba9-79d6-4ace-a3c8-27dcd51d21ed");
            property = env->NewStringUTF("deviceUniqueId");
            if (env->ExceptionCheck() || !uuid_text || !property) break;
            uuid = env->CallStaticObjectMethod(uuid_class, from_string, uuid_text);
            if (env->ExceptionCheck() || !uuid) break;
            java_drm = env->NewObject(drm_class, ctor, uuid);
            if (env->ExceptionCheck() || !java_drm) break;
            bytes = static_cast<jbyteArray>(env->CallObjectMethod(java_drm, get, property));
            if (env->ExceptionCheck() || !bytes) break;
            jsize len = env->GetArrayLength(bytes);
            if (env->ExceptionCheck() || len < 1 || static_cast<size_t>(len) > drm_copy.size()) break;
            env->GetByteArrayRegion(bytes, 0, len, reinterpret_cast<jbyte *>(drm_copy.data()));
            if (env->ExceptionCheck()) break;
            out->ptr = drm_copy.data(); out->length = static_cast<size_t>(len);
            LOG("native DRM synchronized with Java MediaDrm");
        } while (false);
        if (env->ExceptionCheck()) { env->ExceptionClear(); LOG("native DRM skipped: JNI error"); }
        if (java_drm && release) { env->CallVoidMethod(java_drm, release); if (env->ExceptionCheck()) env->ExceptionClear(); }
        if (bytes) env->DeleteLocalRef(bytes);
        if (java_drm) env->DeleteLocalRef(java_drm);
        if (uuid) env->DeleteLocalRef(uuid);
        if (property) env->DeleteLocalRef(property);
        if (uuid_text) env->DeleteLocalRef(uuid_text);
        if (drm_class) env->DeleteLocalRef(drm_class);
        if (uuid_class) env->DeleteLocalRef(uuid_class);
    }
    if (attached) java_vm->DetachCurrentThread();
    reading_drm = false;
    return result;
}

static void install_drm_got() {
    // JUMP_SLOT for the inspected arm64 libliteye.so 7.77.0.
    auto slot = reinterpret_cast<void **>(base + 0x18c460);
    Dl_info original{};
    if (!dladdr(*slot, &original) || !original.dli_fname ||
        !strstr(original.dli_fname, "libmediandk.so") || !original.dli_sname ||
        strcmp(original.dli_sname, "AMediaDrm_getPropertyByteArray")) {
        LOG("native DRM skipped: unexpected import"); return;
    }
    long page_size = sysconf(_SC_PAGESIZE);
    if (page_size <= 0) { LOG("native DRM skipped: page size"); return; }
    uintptr_t page = reinterpret_cast<uintptr_t>(slot) & ~(static_cast<uintptr_t>(page_size) - 1);
    if (mprotect(reinterpret_cast<void *>(page), page_size, PROT_READ | PROT_WRITE) != 0) {
        LOG("native DRM skipped: mprotect"); return;
    }
    original_drm_get = reinterpret_cast<decltype(original_drm_get)>(*slot);
    *slot = reinterpret_cast<void *>(drm_get);
    if (mprotect(reinterpret_cast<void *>(page), page_size, PROT_READ) != 0)
        LOG("native DRM warning: could not restore RELRO");
    LOG("native DRM import synchronized");
}

static void instrument(RegisterContext *ctx, const HookEntryInfo *info) {
    const uintptr_t off = reinterpret_cast<uintptr_t>(info->instruction_address) - base;
    const Site *site = nullptr;
    for (const auto &s : sites) if (s.offset == off) { site = &s; break; }
    if (!site) return;
    auto *obj = reinterpret_cast<uint8_t *>(ctx->general.regs.x0);
    if (!obj || obj[0] != 3) { LOG("%s skipped: unexpected type", site->name); return; }
    // LitEye stores a pointer to a libc++ std::string at object+8.
    auto *str = *reinterpret_cast<uint8_t **>(obj + 8);
    if (!str) { LOG("%s skipped: null string", site->name); return; }
    if (str[0] & 1) { LOG("%s skipped: unexpected long string", site->name); return; }
    const size_t size = str[0] >> 1;
    const size_t expected = strlen(site->from);
    if (size != expected || strlen(site->to) != expected || memcmp(str + 1, site->from, size)) {
        LOG("%s skipped: unexpected value (size=%zu, tag=%u)", site->name, size, unsigned(str[0])); return;
    }
    memcpy(str + 1, site->to, size);
    LOG("%s changed", site->name);
}

static void on_loaded(const char *name, void *handle) {
    if (!name || !strstr(name, "libliteye.so")) return;
    std::lock_guard<std::mutex> guard(lock);
    if (attempted) return;
    attempted = true;
    Dl_info info{};
    void *entry = dlsym(handle, "JNI_OnLoad");
    if (!entry || !dladdr(entry, &info) || !info.dli_fbase) { LOG("cannot locate library"); return; }
    base = reinterpret_cast<uintptr_t>(info.dli_fbase);
    if (reinterpret_cast<uintptr_t>(entry) - base != 0xb2cf4) { LOG("unsupported library entry"); return; }
    for (const auto &s : sites) {
        if (memcmp(reinterpret_cast<void *>(base + s.offset), s.insns, sizeof(s.insns))) {
            LOG("unsupported code at %s", s.name); return;
        }
    }
    // TBZ branches 12 bytes forward, so a 16-byte inline jump would overwrite
    // its destination. Require Dobby's 4-byte near trampoline at every site.
    dobby_enable_near_branch_trampoline();
    size_t installed = 0;
    for (const auto &s : sites) {
        if (DobbyInstrument(reinterpret_cast<void *>(base + s.offset), instrument) != 0) {
            LOG("instrument failed at %s; rolling back", s.name);
            for (size_t i = 0; i < installed; ++i) DobbyDestroy(reinterpret_cast<void *>(base + sites[i].offset));
            return;
        }
        ++installed;
        if (memcmp(reinterpret_cast<void *>(base + s.offset + 4), s.insns + 1, 12)) {
            LOG("%s used a long trampoline; rolling back", s.name);
            for (size_t i = 0; i < installed; ++i) DobbyDestroy(reinterpret_cast<void *>(base + sites[i].offset));
            return;
        }
    }
    LOG("all four native sites instrumented");
    void *property = dlsym(RTLD_DEFAULT, "__system_property_get");
    if (!property || DobbyHook(property, reinterpret_cast<void *>(property_get),
                               reinterpret_cast<void **>(&original_property_get)) != 0) {
        LOG("model property hook failed");
    } else {
        LOG("model property hook installed");
    }
    install_drm_got();
}

extern "C" __attribute__((visibility("default"))) OnLoaded native_init(const NativeAPIEntries *) {
    LOG("native_init");
    return on_loaded;
}
