import {DEFAULTS, MAX_LINES, normalizeSettings, getDuration, createScene, renderFrame, getActiveLine, getLineTiming} from './engine.js';
import {track, trackError, textMetrics} from '/analytics.js';
import {AUDIO_DEFAULTS, normalizeAudioSettings, createPreviewAudio} from './audio.js';
const $ = id => document.getElementById(id);
const STORAGE = 'wordrush.paper-trail.project.v1';
const STROKE_FIELDS=[['arrow-width','arrowWidth'],['circle-width','circleWidth'],['dot-spacing','dotSpacing']];
const MOTION_FIELDS = [
  ['curve','curve','percent'],['travel','travel','travel'],
  ['ease-in','easeIn','percent'],['ease-out','easeOut','percent'],
  ['camera-smooth','cameraSmooth','percent'],['focus-y','focusY','percent'],
  ['spacing','spacing','factor'],['paper-motion','paperMotion','percent'],
  ['paper-speed','paperSpeed','factor'],['edge-blur','edgeBlur','percent'],['blur-width','blurWidth','percent'],
];
const sample = ['It starts with an idea.', 'Then you take a chance.', 'And make it happen.'];
const examples = [sample, ['My name is', 'Furqan', 'And this is just the beginning.'], ['Less scrolling.', 'More creating.', 'Make something that matters.']];
let settings = {...DEFAULTS, ...AUDIO_DEFAULTS, lines: [...sample]};
let quality = '1080', exampleIndex = 0;
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE));
  if (saved && saved.version === 1 && Array.isArray(saved.settings?.lines)) {
    settings = {...normalizeSettings(saved.settings), ...normalizeAudioSettings(saved.settings), lines: saved.settings.lines.filter(v => typeof v === 'string').slice(0,MAX_LINES)};
    if (!settings.lines.length) settings.lines = [''];
    quality = saved.quality === '720' ? '720' : '1080';
  }
} catch { /* The editor also works when browser storage is unavailable. */ }
const canvas = $('preview'), ctx = canvas.getContext('2d', {alpha:false});
let scene, time = getLineTiming(settings,0).highlightStart+getLineTiming(settings,0).highlightDuration, playing = false, loop = false, lastTick = 0, raf = 0, rebuildTimer;
let exportController, exportResult, resultUrl, exporting = false, lastActive = -2, toastTimer;
const previewAudio = createPreviewAudio({onInterrupted:()=>{if(playing)pause();}});
let audioStartRequest=0,audioClockActive=false,audioStarting=false;
let audioGeneration = 0, audioPreparationFailed = false, audioPreparationTimer;
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const stamp = value => {const n=Math.max(0,value);return `${Math.floor(n/60)}:${Math.floor(n%60).toString().padStart(2,'0')}.${Math.floor((n%1)*10)}`;};
function toast(message) {clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.add('visible');toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3200);}
function storyMetrics(){return {...textMetrics(settings.lines.join(' ')),line_count:settings.lines.filter(line=>line.trim()).length};}
function save() {try {localStorage.setItem(STORAGE,JSON.stringify({version:1,settings,quality}));}catch { /* Do not interrupt editing for storage. */ }}
function audioStatus(message='') {$('sound-status').textContent=message;}
function startPreviewAudio() {
  const request=++audioStartRequest;
  audioClockActive=false;audioStarting=false;
  if(!playing||!settings.soundEnabled||(settings.highlightVolume<=0&&settings.whooshVolume<=0))return;
  const generation=audioGeneration;audioStarting=true;
  // Resume synchronously in the gesture, then run both picture and sound from the heard-audio clock.
  void previewAudio.start({position:time,loop,duration:scene.duration,getPosition:()=>time}).then(started=>{
    if(request!==audioStartRequest||generation!==audioGeneration||!playing)return;
    audioStarting=false;audioClockActive=started;lastTick=0;
    if(!started&&settings.soundEnabled)audioStatus('Sound preview is unavailable. Try playing again.');
  }).catch(error=>{
    if(request!==audioStartRequest||generation!==audioGeneration||!playing)return;
    audioStarting=false;audioClockActive=false;lastTick=0;
    audioStatus('Sound preview is unavailable. Try playing again.');
    trackError(error,'paper_trail_audio_preview');
  });
}
function preparePreviewAudio() {
  clearTimeout(audioPreparationTimer);
  const generation=++audioGeneration;
  audioPreparationFailed=false;
  audioStartRequest++;audioClockActive=false;audioStarting=false;previewAudio.pause();
  audioStatus(settings.soundEnabled?'Preparing sound effects…':'');
  const snapshot={...settings,lines:[...settings.lines]};
  void previewAudio.prepare(snapshot).then(()=>{
    if(generation===audioGeneration)audioStatus();
  }).catch(error=>{
    if(generation!==audioGeneration)return;
    audioPreparationFailed=true;
    audioStatus('Could not load sound effects. Try playing again.');
    trackError(error,'paper_trail_audio_prepare');
  });
  if(playing)startPreviewAudio();
}
function fillRange(input) {const p=(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100;input.style.background=`linear-gradient(to right,var(--purple) ${p}%,var(--range-track) ${p}%)`;}
function resizeInput(input) {input.style.height='28px';}
function editLine(index,value) {settings.lines[index]=value;clearTimeout(rebuildTimer);rebuildTimer=setTimeout(()=>rebuild(false),100);save();}
function renderLines(focusIndex) {
  const fragment=document.createDocumentFragment();
  settings.lines.forEach((value,index)=>{
    const row=document.createElement('div');row.className='line-row';row.dataset.index=index;
    const number=document.createElement('span');number.className='line-number';number.textContent=String(index+1).padStart(2,'0');number.setAttribute('aria-hidden','true');
    const input=document.createElement('textarea');input.value=value;input.rows=1;input.wrap='off';input.maxLength=220;input.placeholder=index===0?'First line…':'Next line…';input.setAttribute('aria-label',`Story line ${index+1}`);
    input.addEventListener('input',()=>{resizeInput(input);editLine(index,input.value);});
    input.addEventListener('paste',event=>{
      const text=event.clipboardData?.getData('text/plain');
      if(text?.includes('\n')&&(!input.value||(input.selectionStart===0&&input.selectionEnd===input.value.length))){
        const items=text.split(/\r?\n/).filter(v=>v.trim());
        if(items.length>1){event.preventDefault();if(items.some(v=>v.length>220)){toast('Keep each line under 220 characters.');return;}if(settings.lines.length-1+items.length>MAX_LINES){toast(`A story can have up to ${MAX_LINES} lines.`);return;}settings.lines.splice(index,1,...items);renderLines(index+items.length-1);rebuild(false);save();}
      }
    });
    input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();if(index===settings.lines.length-1)addLine();else $('lines').children[index+1]?.querySelector('textarea')?.focus();}});
    const actions=document.createElement('div');actions.className='line-actions';
    const remove=document.createElement('button');remove.type='button';remove.title='Remove line';remove.setAttribute('aria-label',`Remove line ${index+1}`);remove.innerHTML=icon('close');
    remove.disabled=settings.lines.length===1;
    remove.addEventListener('click',()=>{pause();settings.lines.splice(index,1);renderLines();rebuild(true);save();});actions.append(remove);
    row.append(number,input,actions);fragment.append(row);
  });
  $('lines').replaceChildren(fragment);$('line-count').textContent=`${settings.lines.length} / ${MAX_LINES} lines`;$('add-line').disabled=settings.lines.length>=MAX_LINES;
  requestAnimationFrame(()=>{document.querySelectorAll('.line-row textarea').forEach(resizeInput);if(Number.isInteger(focusIndex))$('lines').children[focusIndex]?.querySelector('textarea')?.focus();});
}
function addLine(){if(settings.lines.length>=MAX_LINES){toast(`A story can have up to ${MAX_LINES} lines.`);return;}settings.lines.push('');renderLines(settings.lines.length-1);rebuild(false);save();}
function syncControls() {
  $('sound-enabled').checked=settings.soundEnabled;
  for(const [id,key] of [['highlight-volume','highlightVolume'],['whoosh-volume','whooshVolume']]){$(id).value=settings[key];$(id+'-value').textContent=`${Math.round(settings[key]*100)}%`;$(id).disabled=!settings.soundEnabled;}
  $('sound-levels').classList.toggle('muted',!settings.soundEnabled);
  for(const id of ['pace','paper','aspect','hold','texture'])$(id).value=settings[id];
  $('text-size').value=settings.textSize;$('custom-color').value=settings.accent;$('quality').value=quality;
  for(const [id,key] of STROKE_FIELDS){$(id).value=settings[key];$(id+'-value').textContent=`${settings[key]} px`;}
  $('arrow-style').value=settings.arrowStyle;$('circle-style').value=settings.circleStyle;$('dot-spacing-field').hidden=settings.arrowStyle!=='dotted'&&settings.circleStyle!=='dotted';
  const shape=settings.highlightShape, shapeName=shape==='underline'?'Underline':shape==='box'?'Box':'Circle';
  $('mark-width-label').textContent=shapeName+' thickness';$('mark-style-label').textContent=shapeName+' style';
  document.querySelectorAll('[data-shape]').forEach(button=>{const active=button.dataset.shape===shape;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',active);});
  $('underline-options').hidden=shape!=='underline';$('box-options').hidden=shape!=='box';
  $('underline-passes').value=settings.underlinePasses;$('box-edges').value=settings.boxEdges;$('box-fill').checked=settings.boxFill;
  $('highlight-fill').value=settings.highlightFill;$('fill-opacity').value=settings.fillOpacity;$('fill-opacity-value').textContent=`${Math.round(settings.fillOpacity*100)}%`;$('box-fill-options').hidden=!settings.boxFill;
  for(const [id,key,format] of MOTION_FIELDS){const value=Number(settings[key]);$(id).value=value;$(id+'-value').textContent=format==='factor'?`${value.toFixed(2)}×`:format==='travel'?`${(value*settings.pace).toFixed(2)} s · ${Math.round(value*100)}%`:`${Math.round(value*100)}%`;}
  $('curve-direction').value=settings.curveDirection;$('frame-rate').value=settings.frameRate;
  $('pace-value').textContent=`${Number(settings.pace).toFixed(1)} s`;$('text-size-value').textContent=settings.textSize;$('texture-value').textContent=`${Math.round(settings.texture*100)}%`;
  document.querySelectorAll('[data-mode]').forEach(b=>{const active=b.dataset.mode===settings.mode;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',active);});
  document.querySelectorAll('[data-color]').forEach(b=>{const active=b.dataset.color.toLowerCase()===settings.accent.toLowerCase();b.classList.toggle('selected',active);b.setAttribute('aria-pressed',active);});
  document.querySelectorAll('input[type=range]').forEach(fillRange);
}
function resizePreview() {
  const stage=$('stage'),style=getComputedStyle(stage);const availW=stage.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),availH=stage.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
  const [w,h]=settings.aspect.split(':').map(Number),width=Math.min(availW,availH*w/h);
  $('canvas-shell').style.width=`${width}px`;$('canvas-shell').style.aspectRatio=`${w} / ${h}`;
  const raster=isFullscreenPreview()?1080:720;
  const pixelWidth=w>=h?Math.round(raster*w/h):raster,pixelHeight=w>=h?raster:Math.round(raster*h/w);
  if(scene&&(canvas.width!==pixelWidth||canvas.height!==pixelHeight)){scene.dispose?.();canvas.width=pixelWidth;canvas.height=pixelHeight;scene=createScene(settings,{width:pixelWidth,height:pixelHeight});draw();}
}

function rebuild(reset=false) {
  clearTimeout(rebuildTimer);scene?.dispose?.();const [w,h]=settings.aspect.split(':').map(Number);const width=w>=h?Math.round(720*w/h):720,height=w>=h?720:Math.round(720*h/w);
  canvas.width=width;canvas.height=height;scene=createScene(settings,{width,height});time=reset?Math.min(getLineTiming(settings,0).highlightStart+getLineTiming(settings,0).highlightDuration,scene.duration):Math.min(time,scene.duration);lastActive=-2;
  $('seek').max=scene.duration;$('duration').textContent=stamp(scene.duration);$('total-number').textContent=String(scene.layout.length).padStart(2,'0');$('export').disabled=scene.layout.length===0||exporting;
  $('top-export').disabled=scene.layout.length===0||exporting;
  $('preview-move').disabled=scene.layout.length<2||exporting;
  $('line-error').textContent=!scene.layout.length?'Add a line to begin your story.':settings.lines.some(v=>!v.trim())?'Empty lines are skipped in your video.':'';
  const fragment=document.createDocumentFragment();scene.layout.forEach((item,i)=>{const b=document.createElement('button');b.type='button';b.className='sequence-item';b.setAttribute('aria-label',`Jump to line ${i+1}: ${item.text}`);const n=document.createElement('span');n.textContent=String(i+1).padStart(2,'0');const text=document.createElement('b');text.textContent=item.text;b.append(n,text);b.addEventListener('click',()=>{pause();time=Math.min(getLineTiming(settings,i).end-settings.pace*.02,scene.duration);draw();});fragment.append(b);});$('sequence').replaceChildren(fragment);resizePreview();draw();preparePreviewAudio();
}
function draw(){if(!scene||!ctx)return;renderFrame(ctx,scene,time);$('seek').value=time;fillRange($('seek'));$('current-time').textContent=stamp(time);const active=getActiveLine(scene,time);if(active!==lastActive){lastActive=active;$('active-number').textContent=String(active+1).padStart(2,'0');document.querySelectorAll('.sequence-item').forEach((b,i)=>{b.classList.toggle('selected',i===active);b.setAttribute('aria-current',i===active?'step':'false');});const rawIndex=settings.lines.map((v,i)=>v.trim()?i:null).filter(v=>v!==null)[active];document.querySelectorAll('.line-row').forEach((r,i)=>r.classList.toggle('active-line',i===rawIndex));}}
function syncPlayback(){$('play').innerHTML=icon(playing?'pause':'play');$('play').setAttribute('aria-label',playing?'Pause preview':'Play preview');$('canvas-play').innerHTML=icon(playing?'pause':'play');$('canvas-play').setAttribute('aria-label',playing?'Pause preview':'Play preview');}
function tick(now){if(!playing)return;if(audioClockActive)time=previewAudio.getTime();else if(!audioStarting&&lastTick)time+=(now-lastTick)/1000;lastTick=now;if(time>=scene.duration){if(loop)time%=scene.duration;else{time=scene.duration;pause();}}draw();if(playing)raf=requestAnimationFrame(tick);}
function play(){if(!scene.layout.length)return;if(audioPreparationFailed)preparePreviewAudio();track('preview_played',{position_seconds:time,duration_seconds:scene.duration});if(time>=scene.duration-.01)time=0;playing=true;lastTick=0;syncPlayback();cancelAnimationFrame(raf);startPreviewAudio();raf=requestAnimationFrame(tick);}
function pause(){playing=false;lastTick=0;audioStartRequest++;audioStarting=false;audioClockActive=false;cancelAnimationFrame(raf);previewAudio.pause();syncPlayback();}
function toggle(){playing?pause():play();}
$('add-line').addEventListener('click',addLine);
$('preview-lines').addEventListener('click',()=>{rebuild(false);$('play').focus({preventScroll:true});$('stage').scrollIntoView({behavior:'auto',block:'center'});play();});
$('example').addEventListener('click',()=>{pause();exampleIndex=(exampleIndex+1)%examples.length;settings.lines=[...examples[exampleIndex]];renderLines();rebuild(true);save();toast('Example loaded.');});
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{settings.mode=b.dataset.mode;syncControls();rebuild(true);save();}));
document.querySelectorAll('[data-color]').forEach(b=>b.addEventListener('click',()=>{settings.accent=b.dataset.color;syncControls();rebuild(false);save();}));
$('custom-color').addEventListener('input',()=>{settings.accent=$('custom-color').value;syncControls();rebuild(false);save();});
for(const [id,key] of [['pace','pace'],['paper','paper'],['aspect','aspect'],['hold','hold'],['text-size','textSize'],['texture','texture']]){
  $(id).addEventListener('input',()=>{settings[key]=['paper','aspect'].includes(key)?$(id).value:Number($(id).value);syncControls();rebuild(key==='aspect');save();});
}
$('quality').addEventListener('change',()=>{quality=$('quality').value;save();});
for(const [id,key] of STROKE_FIELDS){$(id).addEventListener('input',()=>{settings[key]=Number($(id).value);syncControls();save();clearTimeout(rebuildTimer);rebuildTimer=setTimeout(()=>rebuild(false),70);});$(id).addEventListener('change',()=>rebuild(false));}
for(const [id,key] of [['arrow-style','arrowStyle'],['circle-style','circleStyle']])$(id).addEventListener('change',()=>{settings[key]=$(id).value;syncControls();rebuild(false);save();});
document.querySelectorAll('[data-shape]').forEach(button=>button.addEventListener('click',()=>{settings.highlightShape=button.dataset.shape;syncControls();rebuild(false);save();}));
for(const [id,key] of [['underline-passes','underlinePasses'],['box-edges','boxEdges']])$(id).addEventListener('change',()=>{settings[key]=key==='underlinePasses'?Number($(id).value):$(id).value;rebuild(false);save();});
$('box-fill').addEventListener('change',()=>{settings.boxFill=$('box-fill').checked;syncControls();rebuild(false);save();});
for(const [id,key] of [['highlight-fill','highlightFill'],['fill-opacity','fillOpacity']])$(id).addEventListener('input',()=>{settings[key]=key==='fillOpacity'?Number($(id).value):$(id).value;syncControls();save();clearTimeout(rebuildTimer);rebuildTimer=setTimeout(()=>rebuild(false),70);});
for(const [id,key] of MOTION_FIELDS){$(id).addEventListener('input',()=>{settings[key]=Number($(id).value);syncControls();save();clearTimeout(rebuildTimer);rebuildTimer=setTimeout(()=>rebuild(false),70);});$(id).addEventListener('change',()=>rebuild(false));}
$('curve-direction').addEventListener('change',()=>{settings.curveDirection=$('curve-direction').value;rebuild(false);save();});
$('frame-rate').addEventListener('change',()=>{settings.frameRate=Number($('frame-rate').value);save();});
$('preview-move').addEventListener('click',()=>{if(scene.layout.length<2)return;time=Math.max(0,scene.layout[1].start-.2);draw();if(matchMedia('(max-width:620px)').matches)$('stage').scrollIntoView({behavior:'auto',block:'center'});play();});
$('reset-motion').addEventListener('click',()=>{for(const [,key] of MOTION_FIELDS)settings[key]=DEFAULTS[key];settings.curveDirection=DEFAULTS.curveDirection;settings.frameRate=DEFAULTS.frameRate;syncControls();rebuild(false);save();toast('Motion defaults restored. Your words and timing are kept.');});
$('reset-look').addEventListener('click',()=>{for(const key of ['paper','textSize','texture','arrowSize','arrowWidth','circleWidth','arrowStyle','circleStyle','dotSpacing','highlightShape','underlinePasses','boxEdges','boxFill','highlightFill','fillOpacity','accent','ink'])settings[key]=DEFAULTS[key];syncControls();rebuild(false);save();toast('Paper and ink reset. Your words are kept.');});
$('reset-all').addEventListener('click',()=>{pause();const words=[...settings.lines];settings={...normalizeSettings(DEFAULTS),...AUDIO_DEFAULTS,lines:words};quality='1080';loop=false;syncControls();rebuild(true);save();toast('All settings reset. Your text lines are kept.');});
$('sound-enabled').addEventListener('change',()=>{settings.soundEnabled=$('sound-enabled').checked;syncControls();save();preparePreviewAudio();});
for(const [id,key] of [['highlight-volume','highlightVolume'],['whoosh-volume','whooshVolume']]){
  $(id).addEventListener('input',()=>{settings[key]=Number($(id).value);syncControls();save();previewAudio.pause();clearTimeout(audioPreparationTimer);audioPreparationTimer=setTimeout(preparePreviewAudio,70);});
  $(id).addEventListener('change',preparePreviewAudio);
}
$('play').addEventListener('click',toggle);$('canvas-play').addEventListener('click',toggle);
$('seek').addEventListener('input',()=>{pause();time=Number($('seek').value);draw();});
document.addEventListener('keydown',event=>{if(event.code==='Space'&&!['INPUT','TEXTAREA','SELECT','BUTTON','SUMMARY'].includes(document.activeElement.tagName)&&!$('export-dialog').open){event.preventDefault();toggle();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing)pause();lastTick=0;});
new ResizeObserver(resizePreview).observe($('stage'));
let lastLineWidth=0;
new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(Math.abs(width-lastLineWidth)>1){lastLineWidth=width;document.querySelectorAll('.line-row textarea').forEach(resizeInput);}}).observe($('lines'));
function download(){if(!exportResult||!resultUrl)return;track('video_downloaded',{download_source:'paper_trail_export',file_bytes:exportResult.blob.size,width:exportResult.width,height:exportResult.height});const a=document.createElement('a');a.href=resultUrl;a.download=exportResult.filename;document.body.append(a);a.click();a.remove();}
$('download-export').addEventListener('click',download);
$('top-export').addEventListener('click',()=>$('export').click());
function stopExport(){if(exporting){track('render_canceled',{renderer:'paper_trail'});exportController?.abort();$('export-progress-label').textContent='Canceling…';}else $('export-dialog').close();}
$('cancel-export').addEventListener('click',stopExport);$('close-export').addEventListener('click',stopExport);
$('export-dialog').addEventListener('cancel',event=>{if(exporting){event.preventDefault();stopExport();}});
$('export').addEventListener('click',async()=>{
  rebuild(false);if(exporting||!scene.layout.length)return;const exportStarted=performance.now();track('render_started',{...storyMetrics(),renderer:'paper_trail',quality,frame_rate:settings.frameRate,duration_seconds:scene.duration});pause();exporting=true;$('export').disabled=true;$('top-export').disabled=true;$('preview-move').disabled=true;exportController=new AbortController();
  if(resultUrl){URL.revokeObjectURL(resultUrl);resultUrl=null;}exportResult=null;
  $('export-eyebrow').textContent='EXPORTING MP4';$('export-title').textContent='Exporting your video';$('export-description').textContent='Keep this tab open until export finishes.';$('export-progress').style.width='0%';$('export-progress-label').textContent='Preparing video…';$('download-export').hidden=true;$('cancel-export').hidden=false;$('cancel-export').textContent='Cancel';$('export-dialog').showModal();
  try{const {exportVideo}=await import('./export.js');const snapshot=JSON.parse(JSON.stringify(settings));exportResult=await exportVideo(snapshot,{quality,signal:exportController.signal,onProgress:({progress,stage})=>{$('export-progress').style.width=`${Math.round(progress*100)}%`;$('export-progress-label').textContent=`${stage} · ${Math.round(progress*100)}%`;}});
    track('render_completed',{renderer:'paper_trail',elapsed_ms:performance.now()-exportStarted,file_bytes:exportResult.blob.size,width:exportResult.width,height:exportResult.height,frame_rate:exportResult.fps,duration_seconds:exportResult.duration});resultUrl=URL.createObjectURL(exportResult.blob);$('export-eyebrow').textContent='EXPORT COMPLETE';$('export-title').textContent='Your video is ready';$('export-description').textContent=`${exportResult.width} × ${exportResult.height} · ${exportResult.duration.toFixed(1)} seconds · ${(exportResult.blob.size/1024/1024).toFixed(1)} MB`;$('export-progress-label').textContent=`MP4 · ${exportResult.fps} fps`;$('download-export').hidden=false;$('cancel-export').textContent='Done';
  }catch(error){if(error.name==='AbortError'){$('export-dialog').close();toast('Export canceled.');}else{track('render_failed',{renderer:'paper_trail',error_code:error.code||error.name||'Error',elapsed_ms:performance.now()-exportStarted});trackError(error,'paper_trail_export');$('export-eyebrow').textContent='EXPORT FAILED';$('export-title').textContent='Could not export video';$('export-description').textContent=error.message||'Please try exporting again.';$('export-progress-label').textContent='Your text and settings are kept.';$('cancel-export').textContent='Back to editor';}}
  finally{exporting=false;exportController=null;$('export').disabled=!scene.layout.length;$('top-export').disabled=!scene.layout.length;$('preview-move').disabled=scene.layout.length<2;}
});
window.addEventListener('pagehide',()=>{pause();clearTimeout(audioPreparationTimer);previewAudio.dispose();exportController?.abort();scene?.dispose?.();if(resultUrl)URL.revokeObjectURL(resultUrl);});
document.querySelectorAll('.settings-stack details').forEach(panel=>panel.addEventListener('toggle',()=>track('settings_panel_toggled',{panel:panel.id,state:panel.open?'open':'closed'})));
document.addEventListener('change',event=>{const control=event.target;if(control.matches('#lines textarea'))track('text_changed',storyMetrics());else if(control.matches('.settings-stack input,.settings-stack select'))track('setting_changed',{setting:control.id});});
document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.mode)track('setting_changed',{setting:'camera_view',state:button.dataset.mode});else if(button.dataset.shape)track('setting_changed',{setting:'highlight_shape',state:button.dataset.shape});else if(button.dataset.color)track('setting_changed',{setting:'accent'});else if(['reset-all','reset-motion','reset-look'].includes(button.id))track('settings_reset',{control:button.id});});
renderLines();syncControls();rebuild(false);

document.querySelector('.edit-lines-link').addEventListener('click',event=>{event.preventDefault();$('your-lines').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});$('lines').querySelector('textarea')?.focus({preventScroll:true});});

function fitViewport(){const height=window.visualViewport?.height||window.innerHeight;document.documentElement.style.setProperty('--app-height',`${height}px`);document.body.classList.toggle('viewport-short',height<=520);document.body.classList.toggle('viewport-tiny',height<=380);}
fitViewport();window.addEventListener('resize',fitViewport);window.visualViewport?.addEventListener('resize',fitViewport);

let fullscreenRestoreFocus=null,fullscreenSiblings=[];
function isFullscreenPreview(){const panel=$('preview-panel');return document.fullscreenElement===panel||panel.classList.contains('is-fullscreen');}
function restoreFullscreenSiblings(){for(const [element,previous]of fullscreenSiblings)element.inert=previous;fullscreenSiblings=[];}
function isolateFullscreenPreview(){
  restoreFullscreenSiblings();let current=$('preview-panel');
  while(current?.parentElement&&current.parentElement!==document.documentElement){
    for(const sibling of current.parentElement.children)if(sibling!==current&&sibling instanceof HTMLElement){fullscreenSiblings.push([sibling,sibling.inert]);sibling.inert=true;}
    current=current.parentElement;
  }
}
function syncFullscreenPreview(){
  const active=isFullscreenPreview(),button=$('fullscreen-preview');
  button.innerHTML=icon(active?'close':'fullscreen');button.setAttribute('aria-label',active?'Exit full screen preview':'Full screen preview');button.setAttribute('aria-pressed',String(active));button.title=active?'Exit full screen (Esc)':'Full screen preview';
  if(active){isolateFullscreenPreview();button.focus({preventScroll:true});}
  else{restoreFullscreenSiblings();if(fullscreenRestoreFocus?.isConnected)fullscreenRestoreFocus.focus({preventScroll:true});fullscreenRestoreFocus=null;}
  resizePreview();draw();
}
async function toggleFullscreenPreview(){
  const panel=$('preview-panel');
  if(isFullscreenPreview()){
    if(document.fullscreenElement===panel){await document.exitFullscreen();}
    else{panel.classList.remove('is-fullscreen');syncFullscreenPreview();}
    return;
  }
  fullscreenRestoreFocus=document.activeElement;
  try{if(!panel.requestFullscreen||document.fullscreenEnabled===false)throw new Error('Use expanded preview');await panel.requestFullscreen();}
  catch{panel.classList.add('is-fullscreen');syncFullscreenPreview();}
}
$('fullscreen-preview').addEventListener('click',()=>{void toggleFullscreenPreview().catch(()=>toast('Close the expanded preview and try again.'));});
document.addEventListener('fullscreenchange',syncFullscreenPreview);
document.addEventListener('keydown',event=>{
  if(!isFullscreenPreview())return;
  if(event.key==='Escape'&&!document.fullscreenElement){event.preventDefault();$('preview-panel').classList.remove('is-fullscreen');syncFullscreenPreview();}
  if(event.key==='Tab'){
    const controls=[...$('preview-panel').querySelectorAll('button,input,a[href]')].filter(element=>!element.disabled&&!element.hidden&&element.getClientRects().length);
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
});
