import {cp, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
await mkdir('dist/vendor/face_mesh', {recursive:true});
await cp('web', 'dist', {recursive:true});
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
