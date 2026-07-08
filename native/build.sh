#!/bin/bash
# Build ymfm YM2151 core to a standalone WebAssembly module.
# Output: public/ymfm.wasm (loaded by the AudioWorklet at runtime)
set -euo pipefail
cd "$(dirname "$0")"

# emscripten needs python >= 3.10; prefer Homebrew's if the system one is old
if [ -z "${EMSDK_PYTHON:-}" ] && [ -x /opt/homebrew/bin/python3.14 ]; then
  export EMSDK_PYTHON=/opt/homebrew/bin/python3.14
fi
# Point Homebrew's emscripten at its bundled LLVM/binaryen (generated config guesses wrong)
if [ -d /opt/homebrew/opt/emscripten/libexec/llvm/bin ]; then
  export EM_LLVM_ROOT=/opt/homebrew/opt/emscripten/libexec/llvm/bin
  export EM_BINARYEN_ROOT=/opt/homebrew/opt/emscripten/libexec/binaryen
fi

emcc -O3 -std=c++17 -fno-exceptions -fno-rtti \
  --no-entry \
  -s STANDALONE_WASM=1 \
  -s EXPORTED_FUNCTIONS=_opm_init,_opm_write,_opm_generate,_opm_buffer \
  -s ALLOW_MEMORY_GROWTH=0 \
  -s INITIAL_MEMORY=16MB \
  -o ../public/ymfm.wasm \
  glue.cpp ymfm/src/ymfm_opm.cpp

ls -la ../public/ymfm.wasm
