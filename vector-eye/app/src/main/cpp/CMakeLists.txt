cmake_minimum_required(VERSION 3.22.1)
project(eyeoverride LANGUAGES C CXX ASM)
include(FetchContent)
set(DOBBY_GENERATE_SHARED OFF CACHE BOOL "" FORCE)
FetchContent_Declare(dobby GIT_REPOSITORY https://github.com/BepInEx/Dobby.git GIT_TAG 9d271803881f467aabfc24593c7dcaeb710fe861)
FetchContent_MakeAvailable(dobby)
# Repair the pinned Dobby fallback scanner before compiling it.  On ARM the
# search includes three alignment bytes, which must exist in the zero buffer.
set(EYE_DOBBY_NEAR_FILE "${dobby_SOURCE_DIR}/source/MemoryAllocator/NearMemoryArena.cc")
file(READ "${EYE_DOBBY_NEAR_FILE}" EYE_DOBBY_NEAR_SOURCE)
set(EYE_DOBBY_UNSAFE [=[          char *blank_memory = (char *)malloc(alloc_size);
          memset(blank_memory, 0, alloc_size);
#if defined(__arm__) || defined(__aarch64__)
          alloc_size += (4 - 1);]=])
set(EYE_DOBBY_SAFE [=[          int search_size = alloc_size;
#if defined(__arm__) || defined(__aarch64__)
          search_size += (4 - 1);
#endif
          char *blank_memory = (char *)calloc(1, search_size);
          if (!blank_memory) continue;
#if defined(__arm__) || defined(__aarch64__)]=])
string(FIND "${EYE_DOBBY_NEAR_SOURCE}" "${EYE_DOBBY_UNSAFE}" EYE_DOBBY_UNSAFE_POS)
string(FIND "${EYE_DOBBY_NEAR_SOURCE}" "${EYE_DOBBY_SAFE}" EYE_DOBBY_SAFE_POS)
if(NOT EYE_DOBBY_UNSAFE_POS EQUAL -1)
  string(REPLACE "${EYE_DOBBY_UNSAFE}" "${EYE_DOBBY_SAFE}" EYE_DOBBY_NEAR_SOURCE "${EYE_DOBBY_NEAR_SOURCE}")
  string(REPLACE "memmem(region.address, region.length, blank_memory, alloc_size)"
                 "memmem(region.address, region.length, blank_memory, search_size)"
                 EYE_DOBBY_NEAR_SOURCE "${EYE_DOBBY_NEAR_SOURCE}")
  file(WRITE "${EYE_DOBBY_NEAR_FILE}" "${EYE_DOBBY_NEAR_SOURCE}")
elseif(EYE_DOBBY_SAFE_POS EQUAL -1)
  message(FATAL_ERROR "Pinned Dobby scanner source changed; review the bounded-search fix")
endif()
# Fail before memcpy if the code page cannot be made writable.  Callers still
# need to propagate CodePatch errors; inline instrumentation remains disabled.
set(EYE_DOBBY_PATCH_FILE "${dobby_SOURCE_DIR}/source/UserMode/ExecMemory/code-patch-tool-posix.cc")
file(READ "${EYE_DOBBY_PATCH_FILE}" EYE_DOBBY_PATCH_SOURCE)
set(EYE_DOBBY_MPROTECT_OLD "  mprotect((void *)page_align_address, page_size, PROT_READ | PROT_WRITE | PROT_EXEC);")
set(EYE_DOBBY_MPROTECT_NEW "  if (mprotect((void *)page_align_address, page_size, PROT_READ | PROT_WRITE | PROT_EXEC) != 0) return kMemoryOperationError;")
string(FIND "${EYE_DOBBY_PATCH_SOURCE}" "${EYE_DOBBY_MPROTECT_OLD}" EYE_DOBBY_MPROTECT_OLD_POS)
string(FIND "${EYE_DOBBY_PATCH_SOURCE}" "${EYE_DOBBY_MPROTECT_NEW}" EYE_DOBBY_MPROTECT_NEW_POS)
if(NOT EYE_DOBBY_MPROTECT_OLD_POS EQUAL -1)
  string(REPLACE "${EYE_DOBBY_MPROTECT_OLD}" "${EYE_DOBBY_MPROTECT_NEW}" EYE_DOBBY_PATCH_SOURCE "${EYE_DOBBY_PATCH_SOURCE}")
  file(WRITE "${EYE_DOBBY_PATCH_FILE}" "${EYE_DOBBY_PATCH_SOURCE}")
elseif(EYE_DOBBY_MPROTECT_NEW_POS EQUAL -1)
  message(FATAL_ERROR "Pinned Dobby CodePatch source changed; review mprotect guard")
endif()
# Propagate failure of the initial writable-page transition to both public
# APIs.  This does not validate the lifetime or permissions of trampolines.
function(eye_dobby_replace relative old new)
  set(path "${dobby_SOURCE_DIR}/${relative}")
  file(READ "${path}" source)
  string(FIND "${source}" "${old}" old_pos)
  string(FIND "${source}" "${new}" new_pos)
  if(NOT old_pos EQUAL -1)
    string(REPLACE "${old}" "${new}" source "${source}")
    file(WRITE "${path}" "${source}")
  elseif(new_pos EQUAL -1)
    message(FATAL_ERROR "Pinned Dobby source changed: ${relative}")
  endif()
endfunction()
eye_dobby_replace("source/InterceptRouting/InterceptRouting.cpp"
  "  CodePatch(patch_address, (uint8_t *)trampoline_buffer_->getRawBuffer(), trampoline_buffer_->getSize());\n  entry_->is_committed = true;"
  "  if (CodePatch(patch_address, (uint8_t *)trampoline_buffer_->getRawBuffer(), trampoline_buffer_->getSize()) != kMemoryOperationSuccess) { entry_->is_committed = false; return; }\n  entry_->is_committed = true;")
eye_dobby_replace("source/InterceptRouting/Routing/DynamicBinaryInstrument/DynamicBinaryInstrumentExport.cc"
  "  route->Commit();\n\n  return RS_SUCCESS;"
  "  route->Commit();\n  if (!entry->is_committed) { Interceptor::SharedInstance()->RemoveHookEntry(address); return RS_FAILED; }\n\n  return RS_SUCCESS;")
eye_dobby_replace("source/InterceptRouting/Routing/FunctionInlineReplace/FunctionInlineReplaceExport.cc"
  "  route->Commit();\n  return RS_SUCCESS;"
  "  route->Commit();\n  if (!entry->is_committed) { Interceptor::SharedInstance()->RemoveHookEntry(address); return RS_FAILED; }\n  return RS_SUCCESS;")
add_library(eyeoverride SHARED module.cpp)
target_compile_features(eyeoverride PRIVATE cxx_std_17)
target_link_libraries(eyeoverride PRIVATE dobby log dl)
option(EYE_BUILD_SELFTEST "Build standalone device-side instrumentation check" OFF)
if(EYE_BUILD_SELFTEST)
  add_executable(eye_native_selftest selftest.cpp)
  target_compile_features(eye_native_selftest PRIVATE cxx_std_17)
  target_link_libraries(eye_native_selftest PRIVATE dobby log dl)
  add_executable(eye_library_selftest library_selftest.cpp)
  target_compile_features(eye_library_selftest PRIVATE cxx_std_17)
  target_link_libraries(eye_library_selftest PRIVATE dobby log dl)
  add_executable(eye_patch_failure_selftest patch_failure_selftest.cpp)
  target_link_options(eye_patch_failure_selftest PRIVATE "-Wl,--wrap=mprotect")
  target_link_libraries(eye_patch_failure_selftest PRIVATE dobby log dl)
  add_executable(eye_trampoline_map_selftest trampoline_map_selftest.cpp)
  target_compile_features(eye_trampoline_map_selftest PRIVATE cxx_std_17)
  target_link_libraries(eye_trampoline_map_selftest PRIVATE dobby log dl)
endif()
