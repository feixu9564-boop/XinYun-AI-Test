// Independent Butterworth design and forward/backward filtering.
// Audited against scipy.signal.butter/filtfilt; no third-party source copied.
const add=(a,b)=>[a[0]+b[0],a[1]+b[1]],mul=(a,b)=>[a[0]*b[0]-a[1]*b[1],a[0]*b[1]+a[1]*b[0]];
const div=(a,b)=>{const d=b[0]**2+b[1]**2;return [(a[0]*b[0]+a[1]*b[1])/d,(a[1]*b[0]-a[0]*b[1])/d];};
const sqrt=z=>{const r=Math.hypot(...z);return [Math.sqrt((r+z[0])/2),Math.sign(z[1]||1)*Math.sqrt((r-z[0])/2)];};
const polynomial=roots=>{let p=[[1,0]];for(const z of roots){const q=Array.from({length:p.length+1},()=>[0,0]);p.forEach((v,i)=>{q[i]=add(q[i],v);q[i+1]=add(q[i+1],mul(v,[-z[0],-z[1]]));});p=q;}return p.map(z=>z[0]);};
export function butterBandpass(fs,low=.7,high=3,order=3){
  if(!(fs>2*high&&low>0&&high>low))throw Error('invalid_filter_band');
  const l=2*fs*Math.tan(Math.PI*low/fs),h=2*fs*Math.tan(Math.PI*high/fs),B=h-l,w=l*h,poles=[];
  for(let k=0;k<order;k++){
    const theta=Math.PI*(2*k+1+order)/(2*order),p=[B*Math.cos(theta),B*Math.sin(theta)],d=sqrt(add(mul(p,p),[-4*w,0]));
    for(const sign of [-1,1]){const s=[(p[0]+sign*d[0])/2,(p[1]+sign*d[1])/2];poles.push(div([2*fs+s[0],s[1]],[2*fs-s[0],-s[1]]));}
  }
  const a=polynomial(poles),b=polynomial([...Array(order).fill([1,0]),...Array(order).fill([-1,0])]);
  const angle=2*Math.atan(Math.sqrt(w)/(2*fs)),response=c=>c.reduce((v,x,i)=>add(v,[x*Math.cos(-angle*i),x*Math.sin(-angle*i)]),[0,0]);
  const gain=Math.hypot(...response(a))/Math.hypot(...response(b));return {a,b:b.map(x=>x*gain)};
}
export function filtfilt(x,{a,b}){
  if(x.length<3||x.some(v=>!Number.isFinite(v)))throw Error('invalid_filter_input');
  const n=a.length-1,pad=Math.min(3*a.length,x.length-1),dc=b.reduce((s,v)=>s+v,0)/a.reduce((s,v)=>s+v,0);
  const zi=[dc-b[0]];for(let i=1;i<n;i++)zi[i]=zi[i-1]+a[i]*dc-b[i];
  const filter=v=>{const z=zi.map(q=>q*v[0]);return v.map(t=>{const y=b[0]*t+z[0];for(let i=0;i<n-1;i++)z[i]=b[i+1]*t+z[i+1]-a[i+1]*y;z[n-1]=b[n]*t-a[n]*y;return y;});};
  const padded=[...x.slice(1,pad+1).reverse().map(v=>2*x[0]-v),...x,...x.slice(-pad-1,-1).reverse().map(v=>2*x.at(-1)-v)];
  return filter(filter(padded).reverse()).reverse().slice(pad,-pad);
}
