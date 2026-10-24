"""Independent equation-level oracle for mobile v2; SciPy supplies DSP reference.
Not human validation. Historical benchmark.signal remains unchanged.
"""
import numpy as np
from scipy.signal import butter, filtfilt


def pulse(rgb, fs, method):
    rgb=np.asarray(rgb,dtype=float);n=len(rgb)
    if method not in ('POS','CHROM'): raise ValueError('method')
    width=min(n,int(np.ceil(1.6*fs)))
    if method=='CHROM' and width%2 and width<n: width+=1
    step=1 if method=='POS' else max(1,width//2)
    starts=list(range(0,n-width+1,step))
    if starts[-1]!=n-width: starts.append(n-width)
    b,a=butter(3,[.7,3],btype='bandpass',fs=fs)
    filt=lambda x:filtfilt(b,a,x,padlen=min(3*len(a),len(x)-1))
    result=np.zeros(n);weight=np.zeros(n)
    for start in starts:
        block=rgb[start:start+width];r,g,bl=(block/block.mean(axis=0)-1).T
        x,y=(g-bl,g+bl-2*r) if method=='POS' else (3*r-2*g,1.5*r+g-1.5*bl)
        if method=='CHROM':x,y=filt(x),filt(y)
        h=x+(1 if method=='POS' else -1)*x.std()/max(y.std(),1e-10)*y
        win=np.ones(width) if method=='POS' else np.hanning(width)
        result[start:start+width]+=(h-h.mean())*win;weight[start:start+width]+=win
    return filt(result) if method=='POS' else np.divide(result,weight,out=np.zeros(n),where=weight>1e-8)
