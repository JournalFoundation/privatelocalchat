#!/usr/bin/env python3
"""Rebuild the dev-only native tail diagnostics from verified source inputs."""
import argparse, hashlib, json, os, shutil, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def run(args,**kwargs):subprocess.run([str(a) for a in args],check=True,**kwargs)
def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--source',type=Path,required=True,help='Unmodified pinned native source tree')
 parser.add_argument('--toolchain',type=Path,required=True,help='Emscripten 4.0.20 install directory containing bin/ and emscripten/')
 parser.add_argument('--node',type=Path,required=True)
 parser.add_argument('--workdir',type=Path,required=True,help='New isolated output directory')
 args=parser.parse_args();source=args.source.resolve();work=args.workdir.resolve();sdk=args.toolchain.resolve();node=args.node.resolve()
 manifest=json.loads((ROOT/'dev-tools/native-runtime/manifest.json').read_text())
 if work.exists() or work.is_relative_to(source):raise SystemExit('Use a new work directory outside the source tree.')
 for name,want in manifest['baseSourceSha256'].items():
  if digest(source/name)!=want:raise SystemExit('Pinned source mismatch: '+name)
 patch=ROOT/'ops/native/iphone-tail-diagnostics.patch'
 if digest(patch)!=manifest['patchSha256']:raise SystemExit('Diagnostic patch checksum mismatch')
 work.mkdir(parents=True);tree=work/'source';tree.mkdir()
 for name in ['CMakeLists.txt','cpp','scripts','llama.cpp']:run(['cp','-a','--reflink=auto',source/name,tree/name])
 port=tree/'build/emdawn';port.mkdir(parents=True)
 run(['cp','-a','--reflink=auto',source/'build/emdawn/emdawnwebgpu_pkg',port/'emdawnwebgpu_pkg'])
 run(['patch','--batch','--forward','-p1','-i',patch],cwd=tree)
 config=work/'emscripten-config.py';config.write_text('LLVM_ROOT = '+repr(str(sdk/'bin'))+'\nBINARYEN_ROOT = '+repr(str(sdk))+'\nNODE_JS = ['+repr(str(node))+']\nCACHE = '+repr(str(work/'cache'))+'\n')
 env={**os.environ,'EM_CONFIG':str(config)}
 version=subprocess.check_output([str(sdk/'emscripten/emcc'),'--version'],env=env,text=True)
 if '4.0.20' not in version.splitlines()[0]:raise SystemExit('The pinned Emscripten 4.0.20 toolchain is required.')
 build=work/'build-compat'
 run([sdk/'emscripten/emcmake','cmake','-S',tree,'-B',build,'-DCMAKE_BUILD_TYPE=Release','-DWLLAMA_COMPAT=ON','-DGGML_WEBGPU=ON','-DGGML_WEBGPU_JSPI=OFF','-DLLAMA_WASM_MEM64=OFF','-DWLLAMA_TEST_BACKEND=OFF','-DWLLAMA_PRODUCT_SLIM=ON','-DWLLAMA_INITIAL_MEMORY_MIB=96','-DEMDAWNWEBGPU_DIR='+str(port/'emdawnwebgpu_pkg'),'-DLLAMA_BUILD_TESTS=OFF','-DLLAMA_BUILD_TOOLS=OFF','-DLLAMA_BUILD_SERVER=OFF','-DLLAMA_BUILD_EXAMPLES=OFF','-DGGML_NATIVE=OFF'],env=env,cwd=work)
 run(['cmake','--build',build,'--target','wllama','--parallel','8'],env=env,cwd=work)
 out=work/'runtime';out.mkdir();shutil.copyfile(build/'wllama.wasm',out/'compat.wasm');shutil.copyfile(build/'wllama.js',out/'compat-worker.js')
 old=manifest['baseBuildId'];identity=manifest['buildId'];library=(ROOT/'runtime/providers/vendor/wllama/v1q/wllama.js').read_text()
 needle='"'+old+'": "glue-v1:69/23"';assert library.count(needle)==1;library=library.replace(needle,needle+',\n  "'+identity+'": "glue-v1:69/23"')
 needle='"'+old+'"]);';assert library.count(needle)==1;library=library.replace(needle,'"'+old+'", "'+identity+'"]);');(out/'wllama.js').write_text(library)
 manifest['files']={name:{'bytes':(out/name).stat().st_size,'sha256':digest(out/name)} for name in ['compat.wasm','compat-worker.js','wllama.js']}
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print('Built '+identity+' at '+str(out))
if __name__=='__main__':main()
