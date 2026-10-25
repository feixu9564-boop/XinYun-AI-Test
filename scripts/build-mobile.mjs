import {cp, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {BUILD} from '../web/build-info.js';
import {createHash} from 'node:crypto';
await mkdir('dist/vendor/face_mesh', {recursive:true});
await cp('web', 'dist', {recursive:true});
const revision=process.env.BUILD_COMMIT||'LOCAL_UNCOMMITTED';
if(revision!=='LOCAL_UNCOMMITTED'&&!/^[a-f0-9]{40}$/.test(revision))throw Error('Invalid BUILD_COMMIT');
await writeFile('dist/build-info.js',`export const BUILD=${JSON.stringify({version:BUILD.version,commit:revision})};\n`);
const vendor='node_modules/@mediapipe/face_mesh';
const assets=[];
for(const name of await readdir(vendor)) {
  if(!/\.(js|wasm|data|binarypb)$/.test(name)) continue;
  await cp(`${vendor}/${name}`, `dist/vendor/face_mesh/${name}`);
  const bytes=await readFile(`${vendor}/${name}`);
  assets.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await cp(`${vendor}/README.md`, 'dist/vendor/face_mesh/README.md');
await writeFile('dist/assets-manifest.json',JSON.stringify({package:'@mediapipe/face_mesh',version:'0.4.1633559619',assets},null,2));
console.log(JSON.stringify({status:'built',directory:'dist',modelAssets:assets.length,modelBytes:assets.reduce((a,b)=>a+b.bytes,0)}));
