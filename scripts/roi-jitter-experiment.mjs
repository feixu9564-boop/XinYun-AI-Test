// Controlled texture-only experiment through the actual sampleROI function.
// It measures susceptibility, not FaceMesh error on a real face.
import fs from 'node:fs';
import {sampleROI,POLYGONS} from '../web/roi.js';
import {analyze} from '../web/signal.js';
import {rng} from './synthetic-fixtures.mjs';
const random=rng(12026),W=320,H=240,data=new Uint8ClampedArray(W*H*4);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const v=[170+6*Math.sin(x*.4),120+5*Math.cos(y*.3),100+3*Math.sin((x+y)*.5)];
  v.forEach((q,c)=>data[(y*W+x)*4+c]=Math.round(q+(random()-.5)*2));data[(y*W+x)*4+3]=255;
}
globalThis.Path2D=class{constructor(){this.points=[];}moveTo(x,y){this.points.push([x,y]);}lineTo(x,y){this.points.push([x,y]);}closePath(){}};
const inside=(points,x,y)=>{let ok=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])ok=!ok;}return ok;};
const ctx={getImageData:()=>({data}),isPointInPath:(p,x,y)=>inside(p.points,x,y),stroke(){}};
const canvas={width:W,height:H,getContext:()=>ctx};
const base=Array.from({length:455},()=>({x:.5,y:.5}));
base[234]={x:.25,y:.5};base[454]={x:.75,y:.5};base[33]={x:.4,y:.4};base[263]={x:.6,y:.4};
const polygons=[[[.4,.25],[.5,.23],[.6,.25],[.6,.33],[.5,.35],[.4,.33]],[[.3,.45],[.42,.45],[.42,.6],[.3,.6]],[[.58,.45],[.7,.45],[.7,.6],[.58,.6]]];
POLYGONS.forEach((ids,r)=>ids.forEach((id,j)=>base[id]={x:polygons[r][j][0],y:polygons[r][j][1]}));
const sd=a=>{const m=a.reduce((a,b)=>a+b,0)/a.length;return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length);};
const summary=s=>{const sums=s.map(s=>s.rgb.reduce((a,b)=>a+b,0));return {rgbStd:[0,1,2].map(c=>sd(s.map(s=>s.rgb[c]))),chromaStd:Math.max(...[0,1,2].map(c=>sd(s.map((s,i)=>s.rgb[c]/sums[i])))),result:analyze(s)};};
const experiments=[];
for(const jitterPixels of [0,.2,.6,1]){
  let previous=null;const sampled=[],dense=[];
  for(let i=0;i<=320;i++){
    const dx=(random()-.5)*2*jitterPixels,dy=(random()-.5)*2*jitterPixels;
    const lm=base.map(p=>({x:p.x+dx/W,y:p.y+dy/H}));
    const s=sampleROI(lm,canvas,canvas,previous,{diagnostics:true});if(s.reason)throw Error(s.reason);previous=s.previous;delete s.previous;sampled.push({...s,t:i/20});
    const paths=POLYGONS.map(ids=>ids.map(id=>[lm[id].x*W,lm[id].y*H]));let count=0,sum=[0,0,0];
    for(const points of paths){
      const xmin=Math.floor(Math.min(...points.map(p=>p[0]))),xmax=Math.ceil(Math.max(...points.map(p=>p[0]))),ymin=Math.floor(Math.min(...points.map(p=>p[1]))),ymax=Math.ceil(Math.max(...points.map(p=>p[1])));
      for(let y=ymin;y<=ymax;y++)for(let x=xmin;x<=xmax;x++)if(inside(points,x,y)){count++;sum=sum.map((v,c)=>v+data[(y*W+x)*4+c]);}
    }
    dense.push({t:i/20,rgb:sum.map(v=>v/count),faceCount:1,roiValid:true,motion:s.motion,displacement:s.displacement});
  }
  experiments.push({jitterPixels,pointSample:summary(sampled),denseControl:summary(dense),sampleCount:sampled[0].validPixels,pointMotionP95:sampled.map(s=>s.motion).sort((a,b)=>a-b)[304]});
}
const result={seed:12026,width:W,height:H,description:'Stationary synthetic textured uint8 image; uniform landmark translation, no pulse; dense control is an observation, not a production change',experiments};
fs.writeFileSync('docs/issue-12-artifacts/roi-jitter.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
