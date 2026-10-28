import {drawScene, getTiming, loadAssets, getCutAt, sourceIndexForCut} from './scene.js';
import {parsePhrase, MAX_WORDS} from './phrase.js';
import {createBrowserAudio} from './browser-audio.js';
import {getTemplates, renderInBrowser, saveVideo, recentVideos} from './browser-render.js';

const $ = (id) => document.getElementById(id);
const input = $('word');
const requestedWord=new URLSearchParams(location.search).get('word');
if(requestedWord!==null)input.value=requestedWord;
const canvas = $('preview');
const ctx = canvas.getContext('2d');
const motion = $('intensity');
let word = parsePhrase(input.value).phrase;
let timing = getTiming(word);
let assets;
let playing = false;
let position = 0;
let startTime = 0;
let frame;
let sound = false;
let audio;
let audioNodes = [];
let soundGeneration = 0;
const previewAudioBuffers = new Map();
let websiteSources = [];
let sourceRequest = 0;
let rendering = false;
let rendered = false;
let exportWord = '';
let exportIntensity = .75;
const clock = (t) => `${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;

function draw() {
  if (!assets) return;
  if(position>=timing.intro&&assets.sites.length){
    const index=sourceIndexForCut(getCutAt(position-timing.intro).index,assets.sites.length),current=assets;
    if(!current.sites[index].img)void current.loadSite(index).then(()=>{if(assets===current)draw();}).catch(()=>{});
    if(index+1<current.sites.length)void current.loadSite(index+1).catch(()=>{});
  }
  drawScene(ctx, {time:position, word:word || ' ', width:canvas.width, height:canvas.height, assets, intensity:Number(motion.value)/100});
  $('scrubber').value = position;
  if(!rendered) $('center-play').hidden=playing || position>.1;
  $('play-time').textContent = `${clock(position)} / ${clock(Math.ceil(timing.duration))}`;
}
function stopSound() {
  soundGeneration++;
  audioNodes.forEach(s => { try {s.stop();} catch { /* Already finished. */ } });
  audioNodes = [];
}
async function scheduleSound() {
  stopSound();
  if(!sound || !playing || rendered) return;
  const generation=soundGeneration,requested=word;
  try{
    audio ??= new AudioContext();
    await audio.resume();
    if(!previewAudioBuffers.has(requested)){
      if(previewAudioBuffers.size>=8)previewAudioBuffers.delete(previewAudioBuffers.keys().next().value);
      const pending=createBrowserAudio(requested,new URL('/',location.href).href).then(mix=>{
        const buffer=audio.createBuffer(2,mix.frames,mix.sampleRate);
        for(let channel=0;channel<2;channel++){const values=buffer.getChannelData(channel);for(let i=0;i<mix.frames;i++)values[i]=mix.pcm[i*2+channel];}
        return buffer;
      }).catch(error=>{previewAudioBuffers.delete(requested);throw error;});
      previewAudioBuffers.set(requested,pending);
    }
    const buffer=await previewAudioBuffers.get(requested);
    if(generation!==soundGeneration||!playing||!sound||rendered||word!==requested||position>=buffer.duration)return;
    const node=audio.createBufferSource();node.buffer=buffer;node.connect(audio.destination);
    node.onended=()=>node.disconnect();
    node.start(audio.currentTime,position);audioNodes.push(node);
  }catch(error){if(generation===soundGeneration)showError(error.message);}
}
function setPlaying(value) {
  if(!assets || rendered) return;
  if(value && position>=timing.duration-.03)position=0;
  playing=value;
  $('play-symbol').textContent=value?'Ⅱ':'▶';
  $('play-button').setAttribute('aria-label',value?'Pause preview':'Play preview');
  $('center-play').hidden=value;
  cancelAnimationFrame(frame);
  stopSound();
  if(value){startTime=performance.now()-position*1000;scheduleSound();frame=requestAnimationFrame(tick);}
  draw();
}
function tick(now) {
  if(!playing)return;
  position=Math.min(timing.duration,(now-startTime)/1000);
  draw();
  if(position>=timing.duration){setPlaying(false);return;}
  frame=requestAnimationFrame(tick);
}
function useCanvas() {
  if(!rendered)return;
  $('rendered-video').pause();
  $('rendered-video').hidden=true;
  canvas.hidden=false;
  $('video-controls').hidden=false;
  $('timeline-wrap').hidden=false;
  $('back-to-preview').hidden=true;
  $('preview-tip').hidden=false;
  $('preview-mode').textContent='LIVE PREVIEW';
  rendered=false;
  $('center-play').hidden=false;
  draw();
}
function updateWord() {
  useCanvas();
  setPlaying(false);
  const parsed=parsePhrase(input.value);
  word=parsed.phrase;
  timing=getTiming(word || ' ');
  position=0;
  $('word-count').textContent=`${parsed.wordCount} / ${MAX_WORDS} words`;
  $('word-count').style.color=parsed.wordCount>MAX_WORDS?'#a6452b':'';
  input.setAttribute('aria-invalid',String(Boolean(parsed.error)&&Boolean(input.value.trim())));
  $('word-help').textContent=parsed.error&&input.value.trim()?parsed.error:
    word!==input.value.trim()&&word?`Search & website text: “${word}”`:'Up to 8 words. A leading “How to:” is left out.';
  $('intro-duration').textContent=`${timing.intro.toFixed(1)}s`;
  $('scrubber').max=timing.duration;
  $('search-segment').style.flex=timing.intro;
  $('cut-count').textContent=`${timing.cutCount || 50} cuts · 0.1s each`;
  $('form-error').hidden=true;
  draw();
  refreshSourceCache(word);
}

function showSources(records, forWord) {
  websiteSources=records;
  $('source-details').hidden=!records.length;
  $('source-summary').textContent=`${new Set(records.map(s=>s.domain)).size} edited website frames`;
  $('source-caption').textContent=`“${forWord}” is placed into these pages locally for the video. These are edited frames, not original quotes.`;
  const list=$('source-list');list.replaceChildren();
  records.forEach(source=>{
    const link=document.createElement('a');link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';
    const domain=document.createElement('strong');domain.textContent=source.domain;
    const context=document.createElement('span');context.textContent=source.template?`${source.template.before} ${forWord} ${source.template.after}`:source.excerpt || source.editedParagraph || source.title;
    link.append(domain,context);list.append(link);
  });
  $('cut-count').textContent=records.length?`${records.length} sites · ${timing.cutCount || 50} cuts · 0.1s`:'50 cuts · 0.1s each';
}
async function applySources(records, forWord, token) {
  const nextAssets=await loadAssets('/',records,forWord,{lazyTemplates:true});
  await nextAssets.loadSite(0);
  if(token!==sourceRequest || word!==forWord)return;
  assets=nextAssets;
  showSources(records,forWord);
  draw();
}
async function refreshSourceCache(forWord) {
  const token=++sourceRequest;
  websiteSources=[];
  if(assets)assets.sites=[];
  showSources([],forWord);
  draw();
  if(parsePhrase(input.value).error)return;
  try{
    const manifest=await getTemplates();
    if(token!==sourceRequest || word!==forWord)return;
    await applySources(manifest.sources,forWord,token);
  }catch{/* Creating the video fetches fresh sources if no saved capture is available. */}
}
$('play-button').addEventListener('click',()=>setPlaying(!playing));
$('center-play').addEventListener('click',()=>setPlaying(true));
$('replay-button').addEventListener('click',()=>{position=0;setPlaying(true);});
$('scrubber').addEventListener('input',(e)=>{const nextPosition=Number(e.target.value);setPlaying(false);position=nextPosition;draw();});
$('sound-button').addEventListener('click',()=>{
  sound=!sound;
  $('sound-button').setAttribute('aria-pressed',String(sound));
  $('sound-button').setAttribute('aria-label',sound?'Turn preview sound off':'Turn preview sound on');
  $('sound-path').setAttribute('d',sound?'M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14':'m16 9 6 6m0-6-6 6');
  scheduleSound();
});
input.addEventListener('input',updateWord);
document.querySelectorAll('[data-word]').forEach(b=>b.addEventListener('click',()=>{input.value=b.dataset.word;updateWord();setPlaying(true);}));
motion.addEventListener('input',()=>{useCanvas();$('motion-value').textContent=Number(motion.value)<35?'Gentle':Number(motion.value)<85?'Punchy':'Full rush';draw();});
$('back-to-preview').addEventListener('click',useCanvas);
document.addEventListener('keydown',(e)=>{if(e.code==='Space' && !['INPUT','TEXTAREA','BUTTON','SUMMARY','VIDEO','A'].includes(document.activeElement.tagName)){e.preventDefault();if(!rendered)setPlaying(!playing);}});
document.addEventListener('visibilitychange',()=>{if(document.hidden && playing)setPlaying(false);});
window.addEventListener('pagehide',stopSound);

function showError(message) {$('form-error').textContent=message;$('form-error').hidden=false;}
function endRender() {rendering=false;$('create-button').disabled=false;$('create-label').textContent='Create';$('create-arrow').textContent='↗';$('render-progress').hidden=true;}
function showResult(job) {
  endRender();
  $('finished-card').hidden=false;
  $('finished-title').textContent=`“${exportWord || job.word}” is ready.`;
  $('download-link').href=job.url;
  $('download-link').download=job.filename || 'wordrush.mp4';
  $('finished-subtitle').textContent=`${job.sourceCount || 50} websites · 50 cuts · 0.1s each`;
  if(job.sources?.length)showSources(job.sources,job.word);
  if(word === exportWord && Number(motion.value)/100 === exportIntensity){
    setPlaying(false);
    const video=$('rendered-video');video.src=job.url;video.hidden=false;
    canvas.hidden=true;$('center-play').hidden=true;$('video-controls').hidden=true;$('timeline-wrap').hidden=true;
    $('preview-tip').hidden=true;$('back-to-preview').hidden=false;$('preview-mode').textContent='YOUR FINISHED VIDEO';rendered=true;
  }
  loadRecent();
}
$('creator-form').addEventListener('submit',async(e)=>{
  e.preventDefault();
  if(rendering)return;
  const parsed=parsePhrase(input.value),value=parsed.phrase;
  if(parsed.error){showError(parsed.error);input.focus();return;}
  rendering=true;exportWord=value;exportIntensity=Number(motion.value)/100;
  $('create-button').disabled=true;$('create-label').textContent='Making your video…';$('create-arrow').textContent='◌';
  $('render-progress').hidden=false;$('finished-card').hidden=true;$('form-error').hidden=true;
  $('progress-fill').style.width='0%';$('progress-percent').textContent='0%';$('progress-label').textContent='Preparing 50 website frames…';$('progress-note').textContent='Placing your exact text into a sentence on each page.';
  try{
    setPlaying(false);
    const manifest=await getTemplates();
    const result=await renderInBrowser({word:value,sources:manifest.sources,intensity:exportIntensity,onProgress:state=>{
      const percent=Math.min(99,Math.round(state.progress*100));
      $('progress-percent').textContent=`${percent}%`;$('progress-fill').style.width=`${percent}%`;
      $('progress-label').textContent=state.progress<.15?'Preparing your moment':state.progress<.97?'Making your moment':'Finishing your video';
      $('progress-note').textContent=state.stage;
    }});
    const safeName=value.replace(/[^\p{L}\p{N} -]/gu,'').trim().replace(/\s+/gu,'-')||'wordrush';
    const saved={id:crypto.randomUUID(),word:value,filename:`${safeName}.mp4`,createdAt:new Date().toISOString(),blob:result.blob,duration:result.duration,sourceCount:50,version:'browser-templates-v9'};
    try{await saveVideo(saved);}catch{/* A finished video remains downloadable even if local storage is unavailable. */}
    showResult({...saved,url:URL.createObjectURL(result.blob)});
  }catch(error){endRender();showError(error.message);}
});
async function loadRecent(){
  try{
    const items=await recentVideos();
    const list=$('recent-list');list.replaceChildren();
    items.slice(0,6).forEach(item=>{
      const card=document.createElement('article');card.className='recent-item';
      const copy=document.createElement('div');const title=document.createElement('strong');title.textContent=item.word;
      const subtitle=document.createElement('small');subtitle.textContent='Saved on this device';copy.append(title,subtitle);
      const link=document.createElement('a');link.href=URL.createObjectURL(item.blob);link.download=item.filename;link.textContent='↓';link.setAttribute('aria-label',`Download ${item.word}`);
      card.append(copy,link);list.append(card);
    });
    $('recent-section').hidden=!items.length;
  }catch{/* The creator remains available if export history is unavailable. */}
}
try {
  assets=await loadAssets('/');
  $('preview-loading').hidden=true;
  updateWord();
  // A still preview keeps the first visit quiet and respects reduced motion.
}catch(error){
  $('preview-loading').textContent='Preview could not load. Refresh to try again.';
  showError(error.message);
}
loadRecent();
