const clock = seconds => {
  const hundredths=Math.round(Math.max(0,seconds)*100);
  return `${Math.floor(hundredths/6000)}:${String(Math.floor(hundredths/100)%60).padStart(2,'0')}.${String(hundredths%100).padStart(2,'0')}`;
};
const clamp=(n,max)=>Math.min(max,Math.max(0,n));

/** A fixed clip window; drag the real track waveform beneath it. */
export function createMusicTrimmer({onStartTime,onPreview}) {
  const $=id=>document.getElementById(id);
  const root=$('music-trim'),canvas=$('music-waveform'),wrap=$('music-waveform-wrap');
  const slider=$('music-start'),preview=$('music-clip-preview');
  let selection=null,duration=0,disabled=false,maxStart=0,span=0,drag=null;

  function draw(){
    if(!selection||root.hidden)return;
    const width=wrap.clientWidth,height=72,dpr=Math.min(2,devicePixelRatio||1);
    if(!width)return;
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
    const peaks=selection.waveform||[],clip=Math.min(duration,selection.duration);
    span=clip*3;
    const from=selection.startTime-clip;
    ctx.lineWidth=2;ctx.lineCap='round';
    for(let x=2;x<width;x+=4){
      const time=from+x/width*span;
      const inside=time>=0&&time<selection.duration;
      const position=Math.max(0,time/selection.duration*(peaks.length-1));
      const bin=Math.floor(position),fraction=position-bin;
      const value=inside?((peaks[bin]||0)*(1-fraction)+(peaks[bin+1]||0)*fraction):0;
      const bar=inside?Math.max(2,Math.pow(value,.7)*49):1;
      ctx.strokeStyle=x>=width/3&&x<=width*2/3?'#876395':inside?'#c4aecf':'#e0d2e7';
      ctx.beginPath();ctx.moveTo(x,(height-bar)/2);ctx.lineTo(x,(height+bar)/2);ctx.stroke();
    }
  }
  function update(next,clipDuration,{busy=false,auditioning=false}={}){
    selection=next;duration=clipDuration;disabled=busy;root.hidden=!next;
    if(!next)return;
    maxStart=Math.max(0,next.duration-duration);
    $('music-clip-title').textContent=next.title;
    const start=next.startTime||0,end=Math.min(next.duration,start+duration);
    $('music-clip-range').textContent=`${clock(start)} — ${clock(end)}`;
    $('music-clip-length').textContent=`${duration.toFixed(2)}s video`;
    $('music-track-duration').textContent=clock(next.duration);
    $('music-trim-hint').textContent=maxStart>0?'Drag the waveform, or use the slider to jump.':next.duration<duration?'This short sound repeats to fill your video.':'The full track fits your video.';
    slider.max=String(maxStart);slider.value=String(start);slider.disabled=busy||!maxStart;
    slider.setAttribute('aria-valuetext',`${clock(start)} to ${clock(end)}`);
    wrap.classList.toggle('is-disabled',busy||!maxStart);
    preview.disabled=busy;preview.textContent=auditioning?'■ Stop clip':'▶ Preview clip';
    preview.setAttribute('aria-label',auditioning?'Stop selected music clip':'Preview selected music clip');
    draw();
  }
  slider.addEventListener('input',()=>onStartTime(Number(slider.value)));
  preview.addEventListener('click',onPreview);
  wrap.addEventListener('pointerdown',event=>{
    if(disabled||!maxStart||event.button!==0)return;
    drag={id:event.pointerId,x:event.clientX,start:selection.startTime,secondsPerPixel:span/wrap.clientWidth};
    wrap.setPointerCapture(event.pointerId);wrap.classList.add('dragging');
  });
  wrap.addEventListener('pointermove',event=>{
    if(drag?.id!==event.pointerId)return;
    const next=clamp(drag.start-(event.clientX-drag.x)*drag.secondsPerPixel,maxStart);
    onStartTime(Math.round(next*100)/100);
  });
  const endDrag=()=>{drag=null;wrap.classList.remove('dragging');};
  wrap.addEventListener('pointerup',endDrag);wrap.addEventListener('pointercancel',endDrag);wrap.addEventListener('lostpointercapture',endDrag);
  const observer=new ResizeObserver(draw);observer.observe(wrap);
  return {update,dispose:()=>observer.disconnect()};
}
