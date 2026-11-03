import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {AUDIO_DEFAULTS,MARKER_GAIN,normalizeAudioSettings,createAudioPlan,decodeWav,mixAudioPlan,prepareAudio,createPreviewAudio} from '../public/paper-trail/audio.js';
import {createScene,getDuration,getLineTiming} from '../public/paper-trail/engine.js';

const sound=(duration=.56,{sampleRate=48000,channels=2,value=.7}={})=>({sampleRate,numberOfChannels:channels,frames:Math.round(duration*sampleRate),pcm:new Float32Array(Math.round(duration*sampleRate)*channels).fill(value)});
const sounds={marker:sound(),whoosh:sound(1.72)};
const sampleAt=(track,time,channel=0)=>track.pcm[Math.round(time*track.sampleRate)*track.numberOfChannels+channel];
const near=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<tolerance,`${a} should equal ${b}`);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

class FakeContext {
  constructor(){this.state='suspended';this.currentTime=12;this.destination={};this.sources=[];this.resumes=0;this.closed=0;}
  resume(){this.resumes++;this.state='running';return Promise.resolve();}
  close(){this.closed++;this.state='closed';return Promise.resolve();}
  addEventListener(){}
  createGain(){return {gain:{value:1},connect(){},disconnect(){}};}
  createBuffer(channels,frames,sampleRate){const data=Array.from({length:channels},()=>new Float32Array(frames));return {duration:frames/sampleRate,getChannelData:channel=>data[channel]};}
  createBufferSource(){const result={connect(){},disconnect(){},start(...args){this.started=args;},stop(){this.stopped=true;}};this.sources.push(result);return result;}
}
const tinyTrack=()=>({pcm:new Float32Array(48000*2),frames:48000,sampleRate:48000,numberOfChannels:2,peak:.5});

test('audio defaults and volume bounds preserve explicit mute and zero values',()=>{
  assert.deepEqual(AUDIO_DEFAULTS,{soundEnabled:true,highlightVolume:.8,whooshVolume:.5});
  assert.deepEqual(normalizeAudioSettings({soundEnabled:false,highlightVolume:0,whooshVolume:2}),{soundEnabled:false,highlightVolume:0,whooshVolume:1});
  assert.deepEqual(normalizeAudioSettings({soundEnabled:'false',highlightVolume:NaN,whooshVolume:-4}),{soundEnabled:true,highlightVolume:.8,whooshVolume:0});
});

test('effect cues use exact shared arrow and mark timing for every mode, shape, pace and frame rate',()=>{
  for(const mode of ['tilted','crawl','topdown'])for(const highlightShape of ['circle','underline','box'])for(const pace of [1,1.8,4])for(const travel of [.45,.72,.9])for(const frameRate of [30,60]){
    const raw={lines:['First','','Second','Third'],mode,highlightShape,pace,travel,frameRate};
    const scene=createScene(raw),plan=createAudioPlan(raw);
    assert.equal(plan.duration,getDuration(scene.settings));assert.equal(plan.events.length,5);
    const markers=plan.events.filter(event=>event.type==='marker'),arrows=plan.events.filter(event=>event.type==='whoosh');
    markers.forEach((event,index)=>{const timing=getLineTiming(scene.settings,index);near(event.start,timing.highlightStart);near(event.duration,timing.end-timing.highlightStart);near(event.animationDuration,timing.highlightDuration);assert.equal(event.lineIndex,index);});
    arrows.forEach((event,index)=>{near(event.start,getLineTiming(scene.settings,index+1).start);near(event.duration,pace*travel);assert.equal(event.lineIndex,index+1);});
  }
});

test('muted and individually disabled effects do not fetch or create PCM',async()=>{
  assert.equal(await prepareAudio({lines:['One'],soundEnabled:false}),null);
  assert.equal(await prepareAudio({lines:['One','Two'],highlightVolume:0,whooshVolume:0}),null);
  assert.deepEqual(createAudioPlan({lines:['One'],highlightVolume:0}).events,[]);
  assert.deepEqual(createAudioPlan({lines:['One','Two'],whooshVolume:0}).events.map(event=>event.type),['marker','marker']);
});

test('PCM cues fill their exact sample-aligned windows and fade at both ends',()=>{
  const plan={duration:1,events:[{type:'marker',start:.10001,duration:.08,volume:1}]};
  const track=mixAudioPlan(plan,sounds),start=Math.round(.10001*48000),length=Math.round(.08*48000);
  assert.equal(track.frames,48000);assert.equal(track.sampleRate,48000);assert.equal(track.numberOfChannels,2);
  assert.equal(track.pcm[(start-1)*2],0);assert.equal(track.pcm[start*2],0);
  assert.ok(track.pcm[(start+1)*2]>0);near(track.pcm[(start+200)*2],.7*MARKER_GAIN,1e-6);
  assert.equal(track.pcm[(start+length-1)*2],0);assert.equal(track.pcm[(start+length)*2],0);
  for(let i=0;i<track.frames;i++)assert.equal(track.pcm[i*2],track.pcm[i*2+1]);
});

test('marker strokes retain native speed and stop at source end in long windows',()=>{
  const plan={duration:2,events:[{type:'marker',start:.1,duration:1.5,volume:1}]};
  const track=mixAudioPlan(plan,sounds);
  assert.ok(sampleAt(track,.3)>.3);assert.equal(sampleAt(track,.7),0);assert.equal(sampleAt(track,1.3),0);assert.equal(sampleAt(track,1.6),0);
});

test('mono source resampling stays stereo and overlapping cues cannot clip',()=>{
  const mono=sound(.2,{sampleRate:24000,channels:1,value:1});
  const plan={duration:.3,events:[{type:'marker',start:0,duration:.2,volume:1},{type:'whoosh',start:0,duration:.2,volume:1}]};
  const track=mixAudioPlan(plan,{marker:mono,whoosh:mono});
  near(track.peak,.98);near(sampleAt(track,.1),.98,1e-6);assert.equal(sampleAt(track,.1,0),sampleAt(track,.1,1));
  assert.ok(track.pcm.every(Number.isFinite));assert.ok(track.pcm.every(value=>Math.abs(value)<=.980001));
});

test('prepared assets are the isolated marker stroke and whoosh, stereo48k PCM',async()=>{
  for(const [name,duration]of [['marker',24629/48000],['whoosh',66121/48000]]){
    const bytes=await readFile(new URL(`../public/paper-trail/assets/audio/${name}.wav`,import.meta.url));
    const audio=decodeWav(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    assert.equal(audio.sampleRate,48000);assert.equal(audio.numberOfChannels,2);near(audio.frames/audio.sampleRate,duration);
    const peak=audio.pcm.reduce((max,value)=>Math.max(max,Math.abs(value)),0);
    assert.ok(peak>.69&&peak<.72,`${name} asset is normalized near-3dB`);
  }
});

test('preparation preserves exact rounded export length and cancellation',async()=>{
  const duration=6.233333333333333,track=await prepareAudio({lines:['One','Two','Three']},{sounds,duration});
  assert.equal(track.frames,Math.round(duration*48000));assert.equal(track.pcm.length,track.frames*2);
  const controller=new AbortController();controller.abort();
  await assert.rejects(prepareAudio({lines:['One']},{sounds,signal:controller.signal}),{name:'AbortError'});
});

test('preview resumes in the click stack, then takes current visual position after pending preparation',async()=>{
  const ready=deferred(),clock=new FakeContext(),audio=createPreviewAudio({createContext:()=>clock,prepare:()=>ready.promise});
  const prepared=audio.prepare({lines:['One']});let position=.12;
  const starting=audio.start({position:0,getPosition:()=>position,loop:true,duration:1});
  assert.equal(clock.resumes,1,'resume happens before start returns its promise');
  assert.equal(clock.sources.length,0);position=.37;ready.resolve(tinyTrack());await prepared;
  assert.equal(await starting,true);assert.equal(clock.sources.length,1);
  assert.deepEqual(clock.sources[0].started,[12,.37]);assert.equal(clock.sources[0].loop,true);assert.equal(clock.sources[0].loopStart,0);assert.equal(clock.sources[0].loopEnd,1);
  clock.currentTime=13.2;near(audio.getTime(),.57);audio.pause();assert.equal(clock.sources[0].stopped,true);audio.dispose();
});

test('pause invalidates a start waiting for preparation, without a late sound',async()=>{
  const ready=deferred(),clock=new FakeContext(),audio=createPreviewAudio({createContext:()=>clock,prepare:()=>ready.promise});
  const prepared=audio.prepare({lines:['One']});const starting=audio.start({position:.1,duration:1});audio.pause();ready.resolve(tinyTrack());await prepared;
  assert.equal(await starting,false);assert.equal(clock.sources.length,0);audio.dispose();
});

test('superseded starts cannot stop a newer playing source',async()=>{
  const clock=new FakeContext(),audio=createPreviewAudio({createContext:()=>clock,prepare:async()=>tinyTrack()});
  await audio.prepare({lines:['One']});
  const old=audio.start({position:.1,duration:1}),current=audio.start({position:.4,duration:1});
  assert.equal(await old,false);assert.equal(await current,true);assert.equal(clock.sources.length,1);assert.deepEqual(clock.sources[0].started,[12,.4,.6]);assert.equal(clock.sources[0].stopped,undefined);audio.dispose();
});

test('changed preparation retires old playback; failure can retry the same settings',async()=>{
  const clock=new FakeContext();let calls=0;
  const audio=createPreviewAudio({createContext:()=>clock,prepare:async()=>{if(++calls===2)throw new Error('temporary');return tinyTrack();}});
  await audio.prepare({lines:['One']});await audio.start({duration:1});
  await assert.rejects(audio.prepare({lines:['One','Two']}),/temporary/);assert.equal(clock.sources[0].stopped,true);
  await audio.prepare({lines:['One','Two']});assert.equal(calls,3);assert.equal(await audio.start({duration:1}),true);audio.dispose();
});

test('muted preview schedules no source and disposal cancels pending work',async()=>{
  const clock=new FakeContext(),audio=createPreviewAudio({createContext:()=>clock,prepare:async()=>null});
  await audio.prepare({lines:['One'],soundEnabled:false});assert.equal(await audio.start({duration:1}),false);assert.equal(clock.sources.length,0);
  audio.dispose();assert.equal(clock.resumes,0);assert.equal(clock.closed,0);assert.equal(await audio.start({duration:1}),false);
});


test('cleaned real cues are audible within5ms of every event and finish inside each pace/travel window',async()=>{
  const assets={};
  for(const name of ['marker','whoosh']){
    const bytes=await readFile(new URL(`../public/paper-trail/assets/audio/${name}.wav`,import.meta.url));
    assets[name]=decodeWav(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  }
  for(const pace of [1,1.8,4])for(const travel of [.45,.72,.9])for(const [easeIn,easeOut]of [[.1,.75],[.4,.45],[.75,.1]]){
    const plan=createAudioPlan({lines:['One','Two'],pace,travel,easeIn,easeOut});
    for(const event of [plan.events.find(e=>e.type==='marker'),plan.events.find(e=>e.type==='whoosh')]){
      const track=mixAudioPlan({duration:event.duration+.02,events:[{...event,start:.01}]},assets);
      const firstFrame=480,windowFrames=Math.round(event.duration*48000);
      const cueFrames=event.type==='marker'?Math.min(windowFrames,assets.marker.frames):windowFrames;
      const lastFrame=firstFrame+cueFrames,threshold=track.peak*10**(-35/20);
      let audibleStart=-1,audibleEnd=-1;
      for(let frame=0;frame<track.frames;frame++){
        const amplitude=Math.max(Math.abs(track.pcm[frame*2]),Math.abs(track.pcm[frame*2+1]));
        if(frame<firstFrame||frame>=lastFrame)assert.equal(amplitude,0,'no cue leaks beyond its permitted window or the next arrow');
        if(amplitude>=threshold){if(audibleStart<0)audibleStart=frame;audibleEnd=frame;}
      }
      assert.ok(audibleStart>=firstFrame&&audibleStart-firstFrame<=240,`${event.type} starts within5ms at pace${pace}/travel${travel}`);
      assert.ok(audibleEnd<lastFrame&&lastFrame-1-audibleEnd<=576,`${event.type} finishes its natural cue or event window within the final12ms fade`);
    }
  }
});

test('whoosh RMS peak follows the engine top-speed plateau, including asymmetric easing',async()=>{
  const bytes=await readFile(new URL('../public/paper-trail/assets/audio/whoosh.wav',import.meta.url));
  const whoosh=decodeWav(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  for(const [easeIn,easeOut]of [[.1,.75],[.4,.45],[.75,.1]]){
    const event=createAudioPlan({lines:['One','Two'],easeIn,easeOut}).events.find(e=>e.type==='whoosh');
    const track=mixAudioPlan({duration:event.duration,events:[{...event,start:0}]},{whoosh});
    let maxPower=0,peakFrame=0;
    for(let frame=0;frame<track.frames;frame+=240){
      const end=Math.min(track.frames,frame+240);let power=0;
      for(let i=frame*2;i<end*2;i++)power+=track.pcm[i]**2;
      power/=(end-frame)*2;if(power>maxPower){maxPower=power;peakFrame=(frame+end)/2;}
    }
    assert.ok(Math.abs(peakFrame/track.frames-event.peakAt)<.025,'strongest whoosh body tracks fastest arrow motion');
  }
});

test('preview clock uses the audible output timestamp and clamps interpolation to render time',async()=>{
  const clock=new FakeContext();let present=1010;
  clock.getOutputTimestamp=()=>({contextTime:11.98,performanceTime:1000});
  const audio=createPreviewAudio({createContext:()=>clock,prepare:async()=>tinyTrack(),now:()=>present});
  await audio.prepare({lines:['One']});await audio.start({position:.2,duration:1});
  clock.currentTime=12.1;near(audio.getTime(),.2);
  present=1070;near(audio.getTime(),.25);
  present=1300;near(audio.getTime(),.3);
  audio.dispose();
});

test('preview clock falls back to reported hardware latency without introducing RAF drift',async()=>{
  const clock=new FakeContext();clock.baseLatency=.02;clock.outputLatency=.03;
  const audio=createPreviewAudio({createContext:()=>clock,prepare:async()=>tinyTrack()});
  await audio.prepare({lines:['One']});await audio.start({position:.2,duration:1});
  clock.currentTime=12.1;near(audio.getTime(),.25);clock.currentTime=12.3;near(audio.getTime(),.45);
  audio.dispose();
});


test('provided marker PCM plays sample-for-sample at native rate through its full default stroke',async()=>{
  const bytes=await readFile(new URL('../public/paper-trail/assets/audio/marker.wav',import.meta.url));
  const marker=decodeWav(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const plan=createAudioPlan({lines:['One','Two','Three'],whooshVolume:0,highlightVolume:.8});
  assert.equal(marker.frames,24629);assert.equal(marker.sampleRate,48000);
  const track=mixAudioPlan(plan,{marker});
  for(const event of plan.events){
    assert.ok(event.duration>marker.frames/marker.sampleRate,'default reading window fits the whole original stroke');
    assert.equal(event.animationDuration,getLineTiming({lines:['One','Two','Three']},event.lineIndex).highlightDuration);
    const start=Math.round(event.start*48000),length=marker.frames,attack=72,release=144;
    for(let frame=0;frame<length;frame++)for(let channel=0;channel<2;channel++){
      const gain=event.volume*Math.min(1,frame/attack)*Math.min(1,(length-1-frame)/release)*MARKER_GAIN;
      const expected=Math.fround(marker.pcm[frame*2+channel]*gain);
      assert.equal(track.pcm[(start+frame)*2+channel],expected,'no phase warp, repeat, speed change or pitch conversion');
    }
    assert.equal(track.pcm[(start+length)*2],0);
  }
});

test('fast marker windows clip the original source at native speed and fade before the next arrow',async()=>{
  const bytes=await readFile(new URL('../public/paper-trail/assets/audio/marker.wav',import.meta.url));
  const marker=decodeWav(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const plan=createAudioPlan({lines:['One','Two'],pace:1,travel:.9,highlightVolume:1,whooshVolume:0});
  const track=mixAudioPlan(plan,{marker});
  for(const event of plan.events){
    const start=Math.round(event.start*48000),length=Math.round(event.duration*48000);
    assert.ok(length<marker.frames);near(event.duration,.125);
    for(let frame=72;frame<length-144;frame++)for(let channel=0;channel<2;channel++)assert.equal(track.pcm[(start+frame)*2+channel],Math.fround(marker.pcm[frame*2+channel]*MARKER_GAIN));
    assert.equal(track.pcm[(start+length-1)*2],0);assert.equal(track.pcm[(start+length)*2],0);
  }
});


test('approved whoosh PCM remains bit-for-bit unchanged after the native-marker correction',async()=>{
  const bytes=await readFile(new URL('../public/paper-trail/assets/audio/whoosh.wav',import.meta.url));
  const whoosh=decodeWav(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const fixtures=[{"pace": 1, "travel": 0.45, "easeIn": 0.1, "easeOut": 0.75, "hash": "ebb4dc254898e9653c6309d63e109d9221a422ff659eb714292f0c22c51a2a19"}, {"pace": 1.8, "travel": 0.72, "easeIn": 0.4, "easeOut": 0.45, "hash": "7c3cdc77f269309026ed8a2389f6623d6a1e70bdb9126691b0fb309725616091"}, {"pace": 4, "travel": 0.9, "easeIn": 0.75, "easeOut": 0.1, "hash": "82ff88b709223d6ce0ae3a8bdfb853609cb60e424bbdcc7ba0b7ebcf5e014ae8"}];
  for(const fixture of fixtures){
    const plan=createAudioPlan({...fixture,lines:['One','Two','Three'],highlightVolume:0});
    const track=mixAudioPlan(plan,{whoosh});
    assert.equal(createHash('sha256').update(new Uint8Array(track.pcm.buffer)).digest('hex'),fixture.hash);
  }
});


test('marker calibration halves amplitude at every relative volume without changing its native samples or timing',async()=>{
  assert.equal(MARKER_GAIN,.5);assert.equal(AUDIO_DEFAULTS.highlightVolume,.8);
  const bytes=await readFile(new URL('../public/paper-trail/assets/audio/marker.wav',import.meta.url));
  const marker=decodeWav(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  for(const volume of [.1,.35,.8,1]){
    const plan=createAudioPlan({lines:['One'],highlightVolume:volume,whooshVolume:0});
    const event=plan.events[0],track=mixAudioPlan(plan,{marker});
    assert.equal(event.volume,volume,'saved user volume remains unchanged');
    const start=Math.round(event.start*48000),length=Math.min(marker.frames,Math.round(event.duration*48000));
    for(let frame=0;frame<length;frame++)for(let channel=0;channel<2;channel++){
      const originalGain=volume*Math.min(1,frame/72)*Math.min(1,(length-1-frame)/144);
      const previousSample=Math.fround(marker.pcm[frame*2+channel]*originalGain);
      assert.equal(track.pcm[(start+frame)*2+channel],previousSample*.5,'exact50% amplitude reduction with identical pitch/rate/envelope');
    }
  }
});
