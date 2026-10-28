import {writeFile} from 'node:fs/promises';
import {getAudioEvents} from '../public/scene.js';

/** Original synthesized Foley. No source-reel music or downloaded recordings. */
export async function synthesizeAudio(word, outputPath) {
  const schedule=getAudioEvents(word), sr=48000, length=Math.ceil(schedule.duration*sr);
  const signal=new Float32Array(length);
  let seed=4189;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296*2-1;};
  const add=(when,duration,fn)=>{const offset=Math.round(when*sr),n=Math.round(duration*sr);for(let i=0;i<n&&offset+i<length;i++)if(offset+i>=0)signal[offset+i]+=fn(i/sr,i,n);};
  const key=(when,n)=>{
    const pitch=1250+(n%7)*170;
    add(when,.066,(t)=>((random()*.62+Math.sin(t*Math.PI*2*pitch)*.2)*Math.exp(-t*95)+Math.sin(t*Math.PI*2*225)*Math.exp(-t*120)*.3)*.19);
    add(when+.036,.045,t=>random()*Math.exp(-t*145)*.033);
  };
  add(schedule.click,.09,t=>(random()*.65+Math.sin(2*Math.PI*680*t)*.25)*Math.exp(-t*115)*.28);
  schedule.typing.forEach((t,i)=>key(t,i));
  // The camera snaps into the field before a single letter is typed.
  add(schedule.zoom-.035,.34,t=>random()*.18*Math.sin(Math.PI*t/.34)**2+Math.sin(2*Math.PI*(150*t+850*t*t))*.025*Math.sin(Math.PI*t/.34));
  // Enter has a deeper key down + plastic key return, distinct from the letters.
  add(schedule.enter,.13,t=>(random()*.45+Math.sin(2*Math.PI*146*t)*.65)*Math.exp(-t*58)*.32);
  add(schedule.enter+.065,.06,t=>random()*Math.exp(-t*95)*.085);
  // The main accelerating air rush lands precisely on the first montage frame.
  add(schedule.intro-.23,.5,(t)=>{const env=t<.23?Math.pow(t/.23,1.8):Math.exp(-(t-.23)*22);return (random()*.25+Math.sin(2*Math.PI*(135*t+1100*t*t))*.04)*env;});
  add(schedule.intro,.7,t=>Math.sin(2*Math.PI*(59*t-12*t*t))*Math.exp(-t*10)*.25+random()*Math.exp(-t*70)*.11);
  schedule.cuts.slice(1).forEach((when,i)=>{
    const accent=(i+1)%5===0;
    // At ten cuts per second, keep Foley light; broader air accents mark each group.
    add(when-.014,accent?.072:.036,t=>random()*Math.sin(Math.PI*t/(accent?.072:.036))**2*(accent?.026:.009));
    if(i%2===0)add(when,.035,t=>Math.sin(2*Math.PI*(120+(i%4)*35)*t)*Math.exp(-t*125)*.028);
    else add(when,.023,t=>random()*Math.exp(-t*160)*.012);
  });
  // Quiet original analog pulse under the cut run, with a smooth short tail.
  for(let beat=0;beat<10;beat++)add(schedule.intro+beat*.5,.36,t=>Math.sin(2*Math.PI*(61*t-18*t*t))*Math.exp(-t*13)*.055);
  const bytes=Buffer.alloc(44+length*4);bytes.write('RIFF',0);bytes.writeUInt32LE(36+length*4,4);bytes.write('WAVE',8);bytes.write('fmt ',12);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);bytes.writeUInt32LE(sr,24);bytes.writeUInt32LE(sr*4,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(length*4,40);
  for(let i=0;i<length;i++){const fade=Math.min(1,(length-i)/(sr*.13));const v=Math.round(Math.max(-.89,Math.min(.89,Math.tanh(signal[i]*1.6)))*fade*32767);bytes.writeInt16LE(v,44+i*4);bytes.writeInt16LE(v,46+i*4);}
  await writeFile(outputPath,bytes);
  return {path:outputPath,duration:schedule.duration,sampleRate:sr,channels:2};
}
if(process.argv[1]?.endsWith('/audio.mjs')&&process.argv[3])synthesizeAudio(process.argv[2],process.argv[3]).then(r=>console.log(JSON.stringify(r)));
