// Acquisition only: never invent frames/timestamps or synthesize RGB.
// Video callbacks may cease when a WebKit video is not being composited.
// Keep a foreground RAF watchdog; poll only advancing decoded frames or,
// where no decoder counter is exposed, an advancing media currentTime.
export const CAPTURE_VERSION='capture-v0.6.1';
export class FramePump {
  constructor(video,process,onError,{now=()=>performance.now()/1000,raf=fn=>requestAnimationFrame(fn),cancel=id=>cancelAnimationFrame(id)}={}){
    Object.assign(this,{video,process,onError,now,raf,cancel});
    this.active=false;this.busy=false;this.lastCapture=-Infinity;
    this.lastDecoded=null;this.lastPresented=null;this.lastMedia=null;this.lastCurrent=null;this.lastSerial=0;
    this.meta={};this.serial=0;this.callbackAt=-Infinity;
    this.stats={video_callbacks:0,frames_submitted:0,model_completions:0,scheduler_source:'waiting',inference_ms:0,inference_errors:0};
  }
  start(){this.active=true;this.started=this.now();this.armVideo();this.rafId=this.raf(()=>this.tick());}
  stop(){this.active=false;this.cancel(this.rafId);if(this.video.cancelVideoFrameCallback)this.video.cancelVideoFrameCallback(this.videoId);}
  armVideo(){
    if(!this.active||!this.video.requestVideoFrameCallback)return;
    this.videoId=this.video.requestVideoFrameCallback((_,meta)=>{
      if(!this.active)return;this.meta=meta||{};this.serial++;this.callbackAt=this.now();this.stats.video_callbacks++;this.armVideo();
    });
  }
  decoded(){
    try{const n=this.video.getVideoPlaybackQuality?.().totalVideoFrames??this.video.webkitDecodedFrameCount;return Number.isFinite(n)&&n>0?n:null;}catch{return null;}
  }
  select(t){
    const decoded=this.decoded(),current=this.video.currentTime;
    const presented=Number.isFinite(this.meta.presentedFrames)&&this.meta.presentedFrames>0?this.meta.presentedFrames:null;
    const media=Number.isFinite(this.meta.mediaTime)?this.meta.mediaTime:null;
    let source='';
    // Once a decoder counter exists it is stronger evidence than wall/currentTime.
    if(this.serial>this.lastSerial&&t-this.callbackAt<.5){
      if(presented!==null){if(this.lastPresented===null||presented>this.lastPresented)source='video_callback';}
      else if(media!==null){if(this.lastMedia===null||media>this.lastMedia)source='video_callback';}
      else if(decoded===null&&Number.isFinite(current)&&(this.lastCurrent===null||current>this.lastCurrent+.001))source='media_time_fallback';
    }
    if(!source&&decoded!==null&&(this.lastDecoded===null||decoded>this.lastDecoded))source='decoded_counter';
    // A stalled metadata counter is not ignored while callbacks keep arriving.
    if(!source&&decoded===null&&(!this.video.requestVideoFrameCallback||t-Math.max(this.started,this.callbackAt)>=.5)&&Number.isFinite(current)&&(this.lastCurrent===null||current>this.lastCurrent+.001))source='media_time_fallback';
    if(!source)return null;
    return {source,decoded,presented,media,current,serial:this.serial};
  }
  tick(){
    if(!this.active)return;this.rafId=this.raf(()=>this.tick());
    const t=this.now();
    if(this.busy||t-this.lastCapture<.048||this.video.readyState<2||this.video.paused||!this.video.videoWidth||!this.video.videoHeight)return;
    const frame=this.select(t);if(!frame)return;
    this.lastCapture=t;this.lastDecoded=frame.decoded;this.lastPresented=frame.presented;this.lastMedia=frame.media;this.lastCurrent=frame.current;this.lastSerial=frame.serial;
    this.busy=true;this.busySince=t;this.stats.frames_submitted++;this.stats.scheduler_source=frame.source;
    // Serialize the full send promise, even if onResults arrives first. Never
    // overlap WASM inference in an attempt to recover a hung send.
    Promise.resolve().then(()=>{if(this.active)return this.process(t);}).then(()=>{
      if(this.active){this.stats.model_completions++;this.stats.inference_ms=Math.round((this.now()-this.busySince)*1000);}
    }).catch(e=>{if(this.active){this.stats.inference_errors++;this.onError(e);}}).finally(()=>{this.busy=false;});
  }
  snapshot(){return {...this.stats,decoded_frames:this.decoded(),presented_frames:this.meta.presentedFrames??null,media_time:this.meta.mediaTime??null,pending_inference_ms:this.busy?Math.round((this.now()-this.busySince)*1000):0,last_video_time:Number.isFinite(this.video.currentTime)?this.video.currentTime:null,video_ready_state:this.video.readyState,video_paused:this.video.paused};}
  timeoutReason(results){return this.busy?'model_timeout':this.stats.frames_submitted>0&&results===0?'model_result_timeout':'video_frame_stalled';}
}
