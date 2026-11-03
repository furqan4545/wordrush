import {normalizeSettings, getDuration} from './engine.js';

export const AUDIO_DEFAULTS = Object.freeze({soundEnabled:true, highlightVolume:0.8, whooshVolume:0.5});
const SAMPLE_RATE=48000, CHANNELS=2;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const abortError=()=>new DOMException('Sound preparation canceled.','AbortError');
const checkAbort=signal=>{if(signal?.aborted)throw abortError();};
const level=(value,fallback)=>typeof value==='number'&&Number.isFinite(value)?clamp(value,0,1):fallback;

export function normalizeAudioSettings(raw={}) {
  return {soundEnabled:typeof raw.soundEnabled==='boolean'?raw.soundEnabled:AUDIO_DEFAULTS.soundEnabled,
    highlightVolume:level(raw.highlightVolume,AUDIO_DEFAULTS.highlightVolume),
    whooshVolume:level(raw.whooshVolume,AUDIO_DEFAULTS.whooshVolume)};
}

/** Events follow the same line/arrow/reveal timing used by the drawing engine. */
export function createAudioPlan(raw={}) {
  const settings=normalizeSettings(raw), audio=normalizeAudioSettings(raw), events=[];
  if(audio.soundEnabled)settings.lines.forEach((_,lineIndex)=>{
    if(lineIndex&&audio.whooshVolume>0)events.push({type:'whoosh',lineIndex,start:lineIndex*settings.pace,duration:settings.pace*settings.travel,volume:audio.whooshVolume});
    if(audio.highlightVolume>0)events.push({type:'marker',lineIndex,
      start:lineIndex*settings.pace+settings.pace*(lineIndex===0?.05:settings.travel-.025),
      duration:settings.pace*Math.min(.19,.98-settings.travel),volume:audio.highlightVolume});
  });
  return {duration:getDuration(settings),sampleRate:SAMPLE_RATE,numberOfChannels:CHANNELS,events:events.sort((a,b)=>a.start-b.start)};
}

/** Read prepared PCM WAVs directly, without creating an autoplay-sensitive AudioContext. */
export function decodeWav(buffer) {
  const view=new DataView(buffer), text=(offset,length)=>String.fromCharCode(...new Uint8Array(buffer,offset,length));
  if(view.byteLength<44||text(0,4)!=='RIFF'||text(8,4)!=='WAVE')throw new Error('A sound effect could not be read. Reload and try again.');
  let format, channels, sampleRate, bits, dataOffset, dataLength, blockAlign;
  for(let offset=12;offset+8<=view.byteLength;){
    const kind=text(offset,4),length=view.getUint32(offset+4,true),start=offset+8;
    if(start+length>view.byteLength)throw new Error('A sound effect is incomplete. Reload and try again.');
    if(kind==='fmt '){
      if(length<16)throw new Error('A sound effect format is incomplete.');
      format=view.getUint16(start,true);channels=view.getUint16(start+2,true);sampleRate=view.getUint32(start+4,true);blockAlign=view.getUint16(start+12,true);bits=view.getUint16(start+14,true);
      if(format===65534&&length>=40)format=view.getUint16(start+24,true);
    }else if(kind==='data'){dataOffset=start;dataLength=length;}
    offset=start+length+(length%2);
  }
  if(![1,3].includes(format)||![1,2].includes(channels)||!sampleRate||![8,16,24,32].includes(bits)||!dataOffset||!blockAlign||format===3&&bits!==32)throw new Error('This sound effect format is unsupported.');
  const frames=Math.floor(dataLength/blockAlign), pcm=new Float32Array(frames*channels),bytes=bits/8;
  for(let frame=0;frame<frames;frame++)for(let channel=0;channel<channels;channel++){
    const offset=dataOffset+frame*blockAlign+channel*bytes;
    let value;
    if(format===3)value=view.getFloat32(offset,true);
    else if(bits===8)value=(view.getUint8(offset)-128)/128;
    else if(bits===16)value=view.getInt16(offset,true)/32768;
    else if(bits===24){value=view.getUint8(offset)|view.getUint8(offset+1)<<8|view.getUint8(offset+2)<<16;if(value&0x800000)value-=0x1000000;value/=8388608;}
    else value=view.getInt32(offset,true)/2147483648;
    pcm[frame*channels+channel]=Number.isFinite(value)?clamp(value,-1,1):0;
  }
  return {pcm,frames,sampleRate,numberOfChannels:channels};
}

let soundsPromise;
async function loadSounds() {
  soundsPromise??=Promise.all(['marker','whoosh'].map(async name=>{
    const response=await fetch(new URL(`./assets/audio/${name}.wav`,import.meta.url));
    if(!response.ok)throw new Error('Sound effects could not load. Reload and try again.');
    const sound=decodeWav(await response.arrayBuffer());
    if(!sound.frames)throw new Error('A sound effect is empty. Reload and try again.');
    return [name,sound];
  })).then(Object.fromEntries).catch(error=>{soundsPromise=null;throw error;});
  return soundsPromise;
}
async function abortable(promise,signal) {
  checkAbort(signal);if(!signal)return promise;
  let cancel;
  const aborted=new Promise((_,reject)=>{cancel=()=>reject(abortError());signal.addEventListener('abort',cancel,{once:true});});
  try{return await Promise.race([promise,aborted]);}finally{signal.removeEventListener('abort',cancel);}
}

/** Natural-pitch clips are trimmed to their animation window and faded, never looped. */
export function mixAudioPlan(plan,sounds,{duration=plan.duration,signal}={}) {
  checkAbort(signal);
  const frames=Math.max(0,Math.round(duration*SAMPLE_RATE));
  if(!frames||!plan.events.length)return null;
  const pcm=new Float32Array(frames*CHANNELS);
  for(const event of plan.events){
    checkAbort(signal);
    const sound=sounds[event.type];
    if(!sound?.frames)throw new Error('A sound effect is unavailable. Reload and try again.');
    const start=Math.round(event.start*SAMPLE_RATE), available=Math.round(sound.frames/sound.sampleRate*SAMPLE_RATE);
    const length=Math.min(Math.round(event.duration*SAMPLE_RATE),available,frames-start);
    if(length<=0)continue;
    const attack=Math.max(1,Math.min(Math.round(SAMPLE_RATE*.003),Math.floor(length/4)));
    const release=Math.max(1,Math.min(Math.round(SAMPLE_RATE*.012),Math.floor(length/4)));
    for(let frame=0;frame<length;frame++){
      const sourceFrame=frame*sound.sampleRate/SAMPLE_RATE,left=Math.floor(sourceFrame),right=Math.min(sound.frames-1,left+1),fraction=sourceFrame-left;
      const fadeIn=Math.min(1,frame/attack),fadeOut=Math.min(1,(length-1-frame)/release);
      const gain=event.volume*fadeIn*fadeOut;
      for(let channel=0;channel<CHANNELS;channel++){
        const sourceChannel=Math.min(channel,sound.numberOfChannels-1);
        const a=sound.pcm[left*sound.numberOfChannels+sourceChannel],b=sound.pcm[right*sound.numberOfChannels+sourceChannel];
        pcm[(start+frame)*CHANNELS+channel]+=(a+(b-a)*fraction)*gain;
      }
    }
  }
  let peak=0;for(const value of pcm)peak=Math.max(peak,Math.abs(value));
  if(peak>.98){const gain=.98/peak;for(let i=0;i<pcm.length;i++)pcm[i]*=gain;peak=.98;}
  checkAbort(signal);
  return {pcm,frames,sampleRate:SAMPLE_RATE,numberOfChannels:CHANNELS,peak};
}

export async function prepareAudio(raw={}, {duration,signal,sounds}={}) {
  const plan=createAudioPlan(raw);checkAbort(signal);
  if(!plan.events.length)return null;
  const assets=sounds??await abortable(loadSounds(),signal);checkAbort(signal);
  return mixAudioPlan(plan,assets,{duration:duration??plan.duration,signal});
}

/** One continuous PCM source makes preview seeking and looping match the export. */
export function createPreviewAudio({createContext,prepare=prepareAudio,onInterrupted,onEnded}={}) {
  let context,gain,source,buffer,track,pending=Promise.resolve(),signature,prepareSerial=0,playSerial=0,disposed=false,enabled=false;
  let anchorTime=0,anchorOffset=0,activeDuration=0,isLoop=false,position=0,previousSessionType,claimedSession=false;
  const releaseSession=()=>{try{const session=globalThis.navigator?.audioSession;if(claimedSession&&session?.type==='playback')session.type=previousSessionType??'auto';}catch{}claimedSession=false;};
  const claimSession=()=>{try{const session=globalThis.navigator?.audioSession;if(session&&!claimedSession){previousSessionType=session.type;if(session.type!=='playback')session.type='playback';claimedSession=true;}}catch{}};
  const getTime=()=>{if(source&&context){const value=anchorOffset+Math.max(0,context.currentTime-anchorTime);return isLoop&&activeDuration>0?value%activeDuration:Math.min(activeDuration,value);}return position;};
  function stopSource(){
    position=getTime();if(!source)return;
    const current=source;source=null;current.onended=null;
    try{current.stop();}catch{}try{current.disconnect();}catch{}
  }
  function pause(){playSerial++;stopSource();releaseSession();}
  function ensureContext(){
    if(!context||context.state==='closed'){
      const Context=globalThis.AudioContext||globalThis.webkitAudioContext;
      context=createContext?createContext():Context?new Context({sampleRate:SAMPLE_RATE}):null;
      if(!context)return null;
      gain=context.createGain();gain.gain.value=1;gain.connect(context.destination);buffer=null;
      const current=context;
      current.addEventListener?.('statechange',()=>{if(context===current&&source&&current.state!=='running'){pause();onInterrupted?.();}});
    }
    return context;
  }
  return {
    prepare(raw={}){
      if(disposed)return Promise.resolve();
      const plan=createAudioPlan(raw),next=JSON.stringify(plan);
      if(next===signature)return pending;
      pause();signature=next;enabled=plan.events.length>0;const serial=++prepareSerial;track=null;buffer=null;
      pending=Promise.resolve().then(()=>prepare(raw,{duration:plan.duration})).then(value=>{
        if(serial===prepareSerial&&!disposed){track=value;buffer=null;}
      }).catch(error=>{if(serial===prepareSerial)signature=undefined;throw error;});
      return pending;
    },
    async start({position:offset=0,loop=false,duration,getPosition}={}){
      if(disposed||!enabled)return false;
      const serial=++playSerial;
      // This resume call stays before the first await, inside the Play gesture.
      const clock=ensureContext();if(!clock)return false;
      claimSession();let resumed;
      try{resumed=clock.resume();}catch(error){releaseSession();throw error;}
      try{
        await resumed;await pending;
        if(disposed||serial!==playSerial||clock!==context)return false;
        if(!track){stopSource();releaseSession();return false;}
        if(clock.state!=='running')throw new Error('Tap Play again to enable sound.');
        if(!buffer){
          buffer=clock.createBuffer(CHANNELS,track.frames,SAMPLE_RATE);
          for(let channel=0;channel<CHANNELS;channel++){const data=buffer.getChannelData(channel);for(let frame=0;frame<track.frames;frame++)data[frame]=track.pcm[frame*CHANNELS+channel];}
        }
        stopSource();activeDuration=Math.min(buffer.duration,typeof duration==='number'&&Number.isFinite(duration)?Math.max(0,duration):buffer.duration);
        const currentOffset=typeof getPosition==='function'?getPosition():offset;
        const bounded=Number.isFinite(currentOffset)?Math.max(0,currentOffset):0;
        isLoop=Boolean(loop);position=isLoop&&activeDuration>0?bounded%activeDuration:Math.min(activeDuration,bounded);
        if(activeDuration<=0||position>=activeDuration){releaseSession();return false;}
        const current=clock.createBufferSource();current.buffer=buffer;current.loop=isLoop;
        if(isLoop){current.loopStart=0;current.loopEnd=activeDuration;}
        current.connect(gain);source=current;anchorTime=clock.currentTime;anchorOffset=position;
        current.onended=()=>{if(source!==current)return;source=null;position=activeDuration;current.disconnect();releaseSession();onEnded?.();};
        if(isLoop)current.start(anchorTime,position);else current.start(anchorTime,position,activeDuration-position);
        return true;
      }catch(error){if(serial!==playSerial||disposed)return false;pause();throw error;}
    },
    pause,getTime,
    dispose(){if(disposed)return;pause();disposed=true;prepareSerial++;track=null;buffer=null;signature=undefined;try{Promise.resolve(context?.close()).catch(()=>{});}catch{}context=null;},
  };
}
