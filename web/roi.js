// PR #1 forehead/cheek polygons, sampled from the SAME frozen frame sent to
// FaceMesh. Landmark tracking is a heuristic, not liveness or skin validation.
export const POLYGONS=[[109,10,338,337,151,108],[50,101,205,187],[280,330,425,411]];
export function faceGeometry(lm){
  if(!lm||lm.length<455||lm.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return {reason:'invalid_landmarks'};
  if(POLYGONS.flat().some(i=>lm[i].x<.02||lm[i].x>.98||lm[i].y<.02||lm[i].y>.98))return {reason:'face_out_of_frame'};
  const width=Math.hypot(lm[234].x-lm[454].x,lm[234].y-lm[454].y),center=lm[1];
  if(width<.20||width>.85)return {reason:'face_distance'};
  const left=Math.hypot(center.x-lm[234].x,center.y-lm[234].y),right=Math.hypot(center.x-lm[454].x,center.y-lm[454].y);
  if(Math.min(left,right)/Math.max(left,right)<.55||Math.abs(lm[33].y-lm[263].y)/width>.15)return {reason:'face_pose'};
  return {width,x:center.x,y:center.y};
}
export function sampleROI(lm,canvas,overlay,previous){
  const geometry=faceGeometry(lm);if(geometry.reason)return geometry;
  const ctx=canvas.getContext('2d',{willReadFrequently:true}),draw=overlay.getContext('2d'),W=canvas.width,H=canvas.height;
  const data=ctx.getImageData(0,0,W,H).data,sum=[0,0,0],grid=[];let count=0,total=0;
  for(const ids of POLYGONS){
    const path=new Path2D();ids.forEach((i,j)=>{const p=lm[i];j?path.lineTo(p.x*W,p.y*H):path.moveTo(p.x*W,p.y*H);});path.closePath();
    draw.strokeStyle='#60dfb0';draw.lineWidth=1.3;draw.stroke(path);
    const xs=ids.map(i=>lm[i].x*W),ys=ids.map(i=>lm[i].y*H),x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0,h=Math.max(...ys)-y0;
    let validRegion=0;
    // Fixed 12x12 normalized patch grid permits frame-to-frame residual audit.
    for(let iy=0;iy<12;iy++)for(let ix=0;ix<12;ix++){
      const x=Math.floor(x0+(ix+.5)*w/12),y=Math.floor(y0+(iy+.5)*h/12),inside=ctx.isPointInPath(path,x,y),k=(y*W+x)*4;
      const rgb=[data[k],data[k+1],data[k+2]],valid=inside&&Math.min(...rgb)>=10&&Math.max(...rgb)<=245;
      grid.push(valid?rgb:null);if(inside)total++;
      if(valid){rgb.forEach((v,c)=>sum[c]+=v);count++;validRegion++;}
    }
    if(validRegion<20)return {reason:'insufficient_roi_pixels'};
  }
  if(count<80||count/Math.max(total,1)<.8)return {reason:'insufficient_roi_pixels'};
  const rgb=sum.map(v=>v/count);let motion=0;
  if(previous){
    const deltas=grid.flatMap((v,i)=>v&&previous.grid[i]?[v.map((x,c)=>x-previous.grid[i][c])]:[]);
    if(deltas.length<80)return {reason:'unstable_roi'};
    const global=[0,1,2].map(c=>deltas.reduce((s,d)=>s+d[c],0)/deltas.length);
    motion=deltas.reduce((s,d)=>s+d.reduce((n,v,c)=>n+Math.abs(v-global[c]),0)/3,0)/deltas.length;
  }
  const displacement=previous?Math.hypot(geometry.x-previous.x,geometry.y-previous.y)/geometry.width+Math.abs(geometry.width-previous.width):0;
  return {rgb,motion,displacement,faceCount:1,roiValid:true,previous:{...geometry,grid}};
}
