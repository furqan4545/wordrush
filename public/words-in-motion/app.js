import { createFilm, exportFilm } from './engine.js';
import { createMusicController } from './music.js';
import { createMusicTrimmer } from './music-trimmer.js';

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries(['sentence','word-count','input-error','source-list','source-note','formats','pace','pace-value','motion-blur','motion-blur-value','text-size','text-size-value','quality','download-button','download-label','export-status','export-progress','progress-bar','cancel-export','download-again','duration-label','preview-stage','preview','preview-loading','canvas-error','play-button','scrubber','current-time','total-time','loop-button','word-track','dimensions-label','source-credits','reference-dialog','reference-video'].map(id => [id, $(id)]));
const sizes = {landscape:[1280,720],portrait:[720,1280],square:[720,720]};
let film, sources = [], selectedSource, format='landscape', looping=true, revision=0, debounce, exportController, lastBlobUrl, customObjectUrl;
let exporting=false, ready=false, articleImportController;
let music=null, musicTracks=[], musicBusy=false, restoringMusic=true, savedMusicSettings=null;
let musicCategory='all',musicQuery='',musicListSignature='';
let pendingMusicFocus=null;
const musicTrimmer=createMusicTrimmer({onStartTime:setMusicStart,onPreview:()=>auditionMusic(music.getSelection())});
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const countWords = text => text.trim().split(/\s+/u).filter(Boolean);
const showTime = n => Number(n || 0).toFixed(2);
const settingsTabs=[...document.querySelectorAll('.editor-tabs [role="tab"]')];
function openSettings(tab,{focus=false}={}){
  for(const item of settingsTabs){
    const active=item===tab;item.setAttribute('aria-selected',String(active));item.tabIndex=active?0:-1;
    $(item.getAttribute('aria-controls')).hidden=!active;
  }
  if(focus)tab.focus();
}
for(const [index,tab] of settingsTabs.entries()){
  tab.addEventListener('click',()=>openSettings(tab));
  tab.addEventListener('keydown',event=>{
    const next=event.key==='ArrowRight'?(index+1)%settingsTabs.length:event.key==='ArrowLeft'?(index+settingsTabs.length-1)%settingsTabs.length:event.key==='Home'?0:event.key==='End'?settingsTabs.length-1:null;
    if(next!==null){event.preventDefault();openSettings(settingsTabs[next],{focus:true});}
  });
}

try {
  const saved = JSON.parse(localStorage.getItem('wordrush-words-in-motion-v1') || 'null');
  if (saved && typeof saved.text === 'string') els.sentence.value = saved.text;
  if (saved && sizes[saved.format]) format = saved.format;
  if (saved?.pace >= .2 && saved?.pace <= .75) els.pace.value = saved.pace;
  if (saved?.motionBlur != null && Number.isFinite(Number(saved.motionBlur)) && Number(saved.motionBlur) >= 0 && Number(saved.motionBlur) <= 1) els['motion-blur'].value = saved.motionBlur;
  if (saved?.textSize != null && Number.isFinite(Number(saved.textSize)) && Number(saved.textSize) >= 60 && Number(saved.textSize) <= 280) els['text-size'].value = saved.textSize;
  if (saved?.quality === '1080') els.quality.value = saved.quality;
  if (saved?.music && typeof saved.music==='object') savedMusicSettings=saved.music;
} catch { /* Storage can be disabled in private sessions. */ }

music=createMusicController({onChange:()=>{
  renderMusic();
  if(!restoringMusic)persist();
  if(film&&!exporting)syncMusic();
},onStatus:(message,detail)=>setMusicStatus(message,!!detail?.error)});
if(savedMusicSettings?.volume!=null&&Number.isFinite(Number(savedMusicSettings.volume))) music.setVolume(Math.min(1,Math.max(0,Number(savedMusicSettings.volume))));

function persist() {
  try {localStorage.setItem('wordrush-words-in-motion-v1', JSON.stringify({text:els.sentence.value,format,pace:els.pace.value,motionBlur:Number(els['motion-blur'].value),textSize:Number(els['text-size'].value),quality:els.quality.value,source:selectedSource?.id,music:restoringMusic&&savedMusicSettings?savedMusicSettings:{trackId:music?.getSelection()?.isCustom?null:music?.getSelection()?.id??null,volume:music?.getVolume()??.35,startTime:music?.getStartTime()??0}}));} catch {}
}
function setExportStatus(message, error=false) {
  els['export-status'].classList.toggle('error',error);
  if(message) els['export-status'].textContent=message;
  else {
    els['export-status'].replaceChildren();
    for(const text of [globalThis.VideoEncoder?'MP4 VIDEO':'WEBM VIDEO',`${showTime(film?.duration)} SEC`,'NO WATERMARK']) {
      const span=document.createElement('span');span.textContent=text;els['export-status'].append(span);
    }
  }
}
function updateCounts() {
  const words=countWords(els.sentence.value);
  els['word-count'].textContent=`${words.length} ${words.length===1?'word':'words'} / 60`;
  const error=!words.length?'Type a sentence to make your video.':words.length>60?'Keep this cut to 60 words or fewer. Your text has not been shortened.':'';
  els['input-error'].textContent=error;
  els['download-button'].disabled=!!error||!ready||exporting||musicBusy;
  return !error;
}
function updatePlaying(playing) {
  els['play-button'].textContent=playing?'Ⅱ':'▶';
  els['play-button'].setAttribute('aria-label',playing?'Pause preview':'Play preview');
  if(music&&film)music.sync({time:film.getTime(),playing:playing&&!exporting,duration:musicClipDuration()});
}
function updateTime(t) {
  if(!film)return;
  els['current-time'].textContent=showTime(t);
  els.scrubber.value=Math.round((t/film.duration)*1000);
  syncMusic();
}

function syncMusic(){
  if(music&&film)music.sync({time:film.getTime(),playing:film.isPlaying()&&!exporting,duration:musicClipDuration()});
}

function musicClipDuration(){return film?Math.ceil(film.duration*30)/30:0;}
function setMusicStart(seconds){
  const selection=music?.getSelection();if(!selection||exporting||musicBusy)return;
  music.setStartTime(Math.min(Math.max(0,Number(seconds)||0),Math.max(0,selection.duration-musicClipDuration())));
}
async function auditionMusic(track){
  if(!track||exporting||musicBusy)return;
  film?.pause();updatePlaying(false);
  try{if(music.getAuditionId()===track.id)music.stopAudition();else await music.previewTrack(track);}
  catch(error){setMusicStatus(error.message||'This track could not be previewed.',true);}
}

function setMusicStatus(message,error=false){
  $('music-status').textContent=message||'';
  $('music-status').classList.toggle('error',error);
  $('tab-music').classList.toggle('needs-attention',error);
}

function musicTime(seconds){
  const total=Math.round(Number(seconds)||0);return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;
}

function renderMusic(){
  if(!music)return;
  const selection=music.getSelection();
  const auditionId=music.getAuditionId();
  const signature=JSON.stringify([selection?.id,auditionId,exporting,musicBusy,musicCategory,musicQuery,musicTracks.length]);
  const list=$('music-list');
  if(signature!==musicListSignature){
  if(list.contains(document.activeElement))pendingMusicFocus=document.activeElement.dataset.musicFocus||null;
  else if(document.activeElement&&document.activeElement!==document.body)pendingMusicFocus=null;
  musicListSignature=signature;
  const scrollTop=list.scrollTop;list.replaceChildren();
  const none=document.createElement('button');none.type='button';none.className='music-none';none.dataset.musicFocus='none';none.setAttribute('aria-pressed',String(!selection));none.disabled=exporting||musicBusy;
  none.append('No music');const silent=document.createElement('span');silent.textContent='Silent video';none.append(silent);
  none.addEventListener('click',()=>{music.selectNone();setMusicStatus('');});list.append(none);
  const allTracks=[...musicTracks];if(selection?.isCustom)allTracks.push(selection);
  const tracks=allTracks.filter(track=>(musicCategory==='all'||(track.category||'Music')===musicCategory)&&[track.title,track.mood,track.collection,track.originalFilename,track.fileName].filter(Boolean).join(' ').toLowerCase().includes(musicQuery));
  $('music-results-count').textContent=`${tracks.length} ${tracks.length===1?'track':'tracks'}`;
  $('music-filters').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.category===musicCategory)));
  for(const track of tracks){
    const row=document.createElement('div');row.className='music-track';row.classList.toggle('selected',selection?.id===track.id);
    const preview=document.createElement('button');preview.type='button';preview.className='music-audition';preview.dataset.musicFocus=`preview:${track.id}`;preview.disabled=exporting||musicBusy;
    const auditioning=auditionId===track.id;preview.textContent=auditioning?'■':'▶';preview.setAttribute('aria-pressed',String(auditioning));preview.setAttribute('aria-label',`${auditioning?'Stop preview':'Preview'} ${track.title}`);
    preview.addEventListener('click',()=>auditionMusic(track));
    const choose=document.createElement('button');choose.type='button';choose.className='music-select';choose.dataset.musicFocus=`use:${track.id}`;choose.disabled=exporting||musicBusy;choose.setAttribute('aria-pressed',String(selection?.id===track.id));choose.setAttribute('aria-label',`Use ${track.title}`);
    const text=document.createElement('span');text.className='music-track-text';const title=document.createElement('span');title.className='music-track-title';title.textContent=track.title;
    const meta=document.createElement('span');meta.className='music-track-meta';meta.textContent=track.isCustom?`Your audio · ${musicTime(track.duration)}`:`${track.category||track.mood} · ${musicTime(track.duration)}${track.bpm?` · ${track.bpm} BPM`:''}`;
    text.append(title,meta);const check=document.createElement('span');check.className='music-track-check';check.setAttribute('aria-hidden','true');check.textContent='✓';choose.append(text,check);
    choose.addEventListener('click',()=>chooseMusic(track));row.append(preview,choose);list.append(row);
  }
  if(!tracks.length){const empty=document.createElement('p');empty.className='music-empty';empty.textContent='No matching tracks. Try another search.';list.append(empty);}
  list.scrollTop=scrollTop;
  const focused=[...list.querySelectorAll('[data-music-focus]')].find(button=>button.dataset.musicFocus===pendingMusicFocus);
  if(focused&&!focused.disabled){focused.focus({preventScroll:true});pendingMusicFocus=null;}
  }
  $('music-volume').value=music.getVolume();$('music-volume').disabled=exporting||musicBusy;
  $('music-volume-value').textContent=`${Math.round(music.getVolume()*100)}%`;
  $('music-upload-button').disabled=exporting||musicBusy;
  $('music-selection-note').textContent=selection?(selection.isCustom?'Your audio · this tab only':selection.credit||'Inprint Originals'):'Choose a track or upload your own.';
  $('music-fit-note').textContent=selection?(selection.duration<musicClipDuration()?'Repeats to fit':'Selected clip'):'17 tracks from your library';
  $('music-tab-summary').textContent=selection?.title||'Optional';
  $('music-volume-controls').hidden=!selection;
  musicTrimmer.update(selection,musicClipDuration(),{busy:exporting||musicBusy,auditioning:!!selection&&auditionId===selection.id});
}

async function chooseMusic(track){
  if(exporting||musicBusy)return;
  musicBusy=true;renderMusic();updateCounts();setMusicStatus('Loading your music…');
  let loaded=false;
  try{music.stopAudition();await music.loadTrack(track);syncMusic();loaded=true;setMusicStatus('Ready for preview and export.');}
  catch(error){setMusicStatus(error.message||'This track could not load.',true);}
  finally{musicBusy=false;renderMusic();updateCounts();if(loaded&&!$('panel-music').hidden){$('panel-music').scrollTop=0;$('music-clip-preview').focus({preventScroll:true});}}
}
function focusWord(value) {
  const index=typeof value==='number'?value:value?.index;
  els['word-track'].querySelectorAll('button').forEach((button,i)=>button.setAttribute('aria-current',String(i===index)));
}
function showWords(words) {
  els['word-track'].replaceChildren();
  words.forEach((word,i)=>{
    const button=document.createElement('button');
    button.type='button';button.textContent=word.text??String(word);button.setAttribute('aria-label',`Preview word ${i+1}: ${button.textContent}`);
    button.setAttribute('aria-current',String(i===0));
    button.addEventListener('click',()=>{if(!film||exporting)return;film.pause();updatePlaying(false);film.seek(Math.min(film.duration-.001,word.start+Number(els.pace.value)*.4));updateTime(film.getTime());focusWord(i);});
    els['word-track'].append(button);
  });
}
function updateLabels() {
  els['pace-value'].textContent=`${Number(els.pace.value).toFixed(2)}s`;
  els['text-size-value'].textContent=`${Number(els['text-size'].value)}px`;
  els['motion-blur-value'].textContent=`${Math.round(Number(els['motion-blur'].value)*100)}%`;
  els['text-size'].setAttribute('aria-valuetext',`${Number(els['text-size'].value)} pixels`);
  els['motion-blur'].setAttribute('aria-valuetext',`${Math.round(Number(els['motion-blur'].value)*100)} percent`);
  els.pace.setAttribute('aria-valuetext',`${Number(els.pace.value).toFixed(2)} seconds per word`);
  els.formats.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.format===format)));
  els['preview-stage'].classList.toggle('portrait',format==='portrait');
  els['preview-stage'].classList.toggle('square',format==='square');
}
function renderSourceCards() {
  els['source-list'].replaceChildren();
  const visible=sources.slice(0,3);
  if(selectedSource?.custom)visible.push(selectedSource);
  for(const [i,source] of visible.entries()) {
    const button=document.createElement('button');button.className='source-card';button.type='button';
    button.setAttribute('aria-pressed',String(source.id===selectedSource?.id));button.setAttribute('aria-label',source.title);
    const img=document.createElement('img');img.src=source.url;img.alt='';img.loading='lazy';
    const label=document.createElement('span');label.textContent=source.custom?'Your article':['The Sun','Inside page','El Paso'][i]||source.title;
    button.append(img,label);button.addEventListener('click',()=>{if(exporting)return;articleImportController?.abort();selectedSource=source;renderSourceCards();updateSourceNote();scheduleRebuild(true);});
    els['source-list'].append(button);
  }
  els['source-list'].style.gridTemplateColumns=`repeat(${visible.length},minmax(0,1fr))`;
}
function updateSourceNote() {
  $('paper-tab-summary').textContent=selectedSource.custom?'Your article':selectedSource.title.split(' · ')[0];
  els['source-note'].replaceChildren();
  if(selectedSource.custom)els['source-note'].textContent='Your screenshot · stored in this tab only';
  else {
    const link=document.createElement('a');link.href=selectedSource.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent=`${selectedSource.title} ↗`;
    els['source-note'].append('Real newspaper · ',link);
  }
}
function scheduleRebuild(immediate=false) {
  revision+=1;ready=false;els['play-button'].disabled=true;
  persist();updateLabels();clearTimeout(debounce);
  if(!updateCounts()) { film?.pause();updatePlaying(false);return; }
  ready=false;els['download-button'].disabled=true;
  debounce=setTimeout(()=>rebuild(),immediate?0:380);
}
async function rebuild({initial=false}={}) {
  if(exporting||!selectedSource||!updateCounts())return;
  const ticket=++revision;
  const wasPlaying=initial?!reducedMotion:film?.isPlaying();
  film?.pause();updatePlaying(false);
  els['canvas-error'].hidden=true;
  try {
    const [width,height]=sizes[format];
    const next=await createFilm({canvas:els.preview,text:els.sentence.value,width,height,secondsPerWord:Number(els.pace.value),motionBlur:Number(els['motion-blur'].value),textSize:Number(els['text-size'].value),pushPull:1,sourceMode:'paper',assets:[selectedSource],onWord:focusWord,onTime:updateTime,onEnd:()=>{
      if(looping&&!exporting){film?.seek(0);film?.play();updatePlaying(true);}
      else updatePlaying(false);
    }});
    if(ticket!==revision){next.dispose();return;}
    film?.dispose();film=next;syncMusic();
    if(music.getSelection())setMusicStart(music.getStartTime());
    renderMusic();
    film.render(0);film.seek(0);
    showWords(film.words);focusWord(0);
    els['total-time'].textContent=showTime(film.duration);els['current-time'].textContent='0.00';els.scrubber.value=0;
    els['dimensions-label'].textContent=`${width} × ${height} · 30 FPS`;
    ready=true;els['preview-loading'].hidden=true;els['play-button'].disabled=false;
    els['download-label'].textContent=globalThis.VideoEncoder?'Download MP4':'Download video';
    setExportStatus();updateCounts();
    if(wasPlaying){film.play();updatePlaying(true);}
  } catch(error) {
    if(ticket!==revision)return;
    ready=false;els['preview-loading'].hidden=true;
    els['canvas-error'].textContent=`We couldn't load this paper. Choose another scan or upload an article screenshot. ${error.message||''}`;
    els['canvas-error'].hidden=false;
    els['download-label'].textContent='Preview unavailable';
  }
}

els.sentence.addEventListener('input',()=>scheduleRebuild());
els.pace.addEventListener('input',()=>scheduleRebuild());
els['motion-blur'].addEventListener('input',()=>scheduleRebuild());
els['text-size'].addEventListener('input',()=>scheduleRebuild());
els.quality.addEventListener('change',persist);
els.formats.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{if(exporting)return;format=button.dataset.format;scheduleRebuild(true);}));
els['play-button'].addEventListener('click',()=>{if(!film||exporting)return;if(film.isPlaying()){film.pause();updatePlaying(false);}else{music.stopAudition();music.resume().catch(error=>setMusicStatus(error.message,true));if(film.getTime()>=film.duration-.01)film.seek(0);film.play();updatePlaying(true);}});
els.scrubber.addEventListener('input',()=>{if(!film||exporting)return;film.pause();updatePlaying(false);film.seek(Number(els.scrubber.value)/1000*film.duration);updateTime(film.getTime());});
els['loop-button'].addEventListener('click',()=>{looping=!looping;els['loop-button'].setAttribute('aria-pressed',String(looping));});
$('reference-button').addEventListener('click',()=>{music.stopAudition();film?.pause();updatePlaying(false);els['reference-dialog'].showModal();});
$('close-reference').addEventListener('click',()=>els['reference-dialog'].close());
els['reference-dialog'].addEventListener('close',()=>els['reference-video'].pause());
els['reference-dialog'].addEventListener('click',event=>{if(event.target===els['reference-dialog']){const rect=els['reference-dialog'].getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)els['reference-dialog'].close();}});
$('upload-button').addEventListener('click',()=>{if(articleImportController){articleImportController.abort();return;}if(!exporting)$('article-upload').click();});
$('article-upload').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  if(file.size>20*1024*1024){setExportStatus('Choose an image smaller than 20 MB.',true);return;}
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)){setExportStatus('Choose a JPG, PNG, or WebP screenshot.',true);return;}
  const url=URL.createObjectURL(file);
  const controller=new AbortController();articleImportController=controller;
  film?.pause();updatePlaying(false);ready=false;els['download-button'].disabled=true;
  $('upload-button').textContent='Cancel reading';
  try {
    const img=new Image();img.src=url;await img.decode();
    if(img.width<300||img.height<300)throw new Error('Use a screenshot at least 300 × 300 pixels.');
    setExportStatus('Reading the article in your browser…');
    const {extractArticleText}=await import('./article-import.js');
    const {articleText}=await extractArticleText(file,{signal:controller.signal,onProgress:progress=>setExportStatus(`Reading the article · ${Math.round(progress*100)}%`)});
    if(controller.signal.aborted)throw new DOMException('Reading canceled.','AbortError');
    if(customObjectUrl)URL.revokeObjectURL(customObjectUrl);customObjectUrl=url;
    selectedSource={id:'custom',title:file.name,url,width:img.width,height:img.height,articleText,type:'newspaper',custom:true,paperColor:'#efefec',region:{x:img.width*.12,y:img.height*.2,width:img.width*.76,height:img.height*.6}};
    renderSourceCards();updateSourceNote();scheduleRebuild(true);
  } catch(error){URL.revokeObjectURL(url);setExportStatus(error.name==='AbortError'?'Article reading canceled.':error.message||'This image could not be opened.',error.name!=='AbortError');ready=!!film;updateCounts();}
  finally{if(articleImportController===controller){articleImportController=undefined;$('upload-button').innerHTML='Use my article <span aria-hidden="true">↗</span>';}}
  event.target.value='';
});

$('music-upload-button').addEventListener('click',()=>{if(!exporting&&!musicBusy)$('music-upload').click();});
$('music-upload').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  musicBusy=true;music.stopAudition();renderMusic();updateCounts();setMusicStatus('Reading your audio…');
  try{await music.loadFile(file);syncMusic();setMusicStatus('Your audio is ready. It stays in this tab.');}
  catch(error){setMusicStatus(error.message||'This audio could not be opened.',true);}
  finally{musicBusy=false;event.target.value='';renderMusic();updateCounts();}
});
$('music-volume').addEventListener('input',()=>music.setVolume(Number($('music-volume').value)));
$('music-search').addEventListener('input',event=>{musicQuery=event.target.value.trim().toLowerCase();renderMusic();});
$('music-filters').querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{musicCategory=button.dataset.category;renderMusic();}));

els['cancel-export'].addEventListener('click',()=>exportController?.abort());
els['download-button'].addEventListener('click',async()=>{
  if(exporting||musicBusy||!ready||!updateCounts())return;
  clearTimeout(debounce);
  music.stopAudition();film.pause();updatePlaying(false);exporting=true;renderMusic();exportController=new AbortController();
  const signal=exportController.signal;
  els['download-button'].disabled=true;els['download-label'].textContent='Making your video…';els['export-progress'].hidden=false;els['progress-bar'].value=0;els['download-again'].hidden=true;
  for(const el of [els.sentence,els.pace,els['motion-blur'],els['text-size'],els.quality,els.scrubber,els['play-button']])el.disabled=true;
  let exportMovie;
  try {
    const quality=Number(els.quality.value);
    const resolution=format==='landscape'?[Math.round(quality*16/9/2)*2,quality]:format==='portrait'?[quality,Math.round(quality*16/9/2)*2]:[quality,quality];
    exportMovie=await createFilm({canvas:document.createElement('canvas'),text:els.sentence.value,width:resolution[0],height:resolution[1],secondsPerWord:Number(els.pace.value),motionBlur:Number(els['motion-blur'].value),textSize:Number(els['text-size'].value),pushPull:1,sourceMode:'paper',assets:[selectedSource]});
    const onProgress=progress=>{
      const pct=Math.max(0,Math.min(100,Math.round(progress<=1?progress*100:progress)));
      els['progress-bar'].value=pct;els['download-label'].textContent=`Making your video · ${pct}%`;
    };
    let result;
    const audio=music.getExportAudio();
    try{result=await exportFilm({film:exportMovie,format:globalThis.VideoEncoder?'mp4':'webm',signal,onProgress,audio});}
    catch(error){
      if((/cannot encode MP4|MP4 export is unavailable/.test(error.message)||['AUDIO_ENCODER_UNAVAILABLE','AAC_UNSUPPORTED'].includes(error.code))&&!signal.aborted){setExportStatus('Using the video format supported by this browser…');result=await exportFilm({film:exportMovie,format:'webm',signal,onProgress,audio});}
      else throw error;
    }
    if(signal.aborted)throw new DOMException('Export canceled.','AbortError');
    const blob=result.blob??result;
    const extension=result.extension??(blob.type.includes('mp4')?'mp4':'webm');
    if(!(blob instanceof Blob)||blob.size===0)throw new Error('The video encoder returned an empty file.');
    if(lastBlobUrl)URL.revokeObjectURL(lastBlobUrl);lastBlobUrl=URL.createObjectURL(blob);
    const title=countWords(els.sentence.value).slice(0,6).join('-').replace(/[^\p{L}\p{N}-]/gu,'').toLowerCase()||'my-sentence';
    const link=els['download-again'];link.href=lastBlobUrl;link.download=`wordrush-words-in-motion-${title}.${extension}`;link.hidden=false;link.click();
    setExportStatus(`Your ${extension.toUpperCase()} is ready · ${(blob.size/1024/1024).toFixed(1)} MB`);
  } catch(error) {
    setExportStatus(error.name==='AbortError'?'Export canceled. Your sentence is still here.':`${error.message||'Could not export this video.'} Try 720p or open the studio in Edge.`,error.name!=='AbortError');
  } finally {
    exportMovie?.dispose();exporting=false;exportController=null;els['export-progress'].hidden=true;
    for(const el of [els.sentence,els.pace,els['motion-blur'],els['text-size'],els.quality,els.scrubber,els['play-button']])el.disabled=false;
    els['download-label'].textContent=globalThis.VideoEncoder?'Download MP4':'Download video';renderMusic();updateCounts();
  }
});

document.addEventListener('visibilitychange',()=>{if(document.hidden){music.stopAudition();if(!exporting){film?.pause();updatePlaying(false);}}});
window.addEventListener('beforeunload',()=>{musicTrimmer.dispose();music.dispose();film?.dispose();if(lastBlobUrl)URL.revokeObjectURL(lastBlobUrl);if(customObjectUrl)URL.revokeObjectURL(customObjectUrl);});
async function init() {
  updateLabels();updateCounts();
  renderMusic();
  const musicLibrary=fetch('./assets/music/tracks.json').then(response=>{if(!response.ok)throw new Error('The music library could not load.');return response.json();}).catch(error=>{setMusicStatus(`${error.message} You can still upload WAV or MP3.`,true);return [];});
  try {
    const response=await fetch('./assets/sources.json');if(!response.ok)throw new Error('Newspaper sources did not load.');
    sources=await response.json();
    let savedSource;try{savedSource=JSON.parse(localStorage.getItem('wordrush-words-in-motion-v1')||'null')?.source;}catch{}
    selectedSource=sources.find(s=>s.id===savedSource)||sources[0];
    renderSourceCards();updateSourceNote();
    for(const source of sources.slice(0,3)) {
      const a=document.createElement('a');a.textContent=source.attribution+' ↗';a.href=source.sourceUrl;a.target='_blank';a.rel='noopener noreferrer';els['source-credits'].append(a);
    }
    await rebuild({initial:!savedMusicSettings?.trackId});
    musicTracks=await musicLibrary;renderMusic();
    const restoreTrack=musicTracks.find(track=>track.id===savedMusicSettings?.trackId);
    const restoreStartTime=Number(savedMusicSettings?.startTime)||0;
    if(restoreTrack){
      film?.pause();updatePlaying(false);
      try{musicBusy=true;renderMusic();updateCounts();setMusicStatus('Restoring your music…');await music.loadTrack(restoreTrack);syncMusic();music.setStartTime(Math.min(Math.max(0,restoreStartTime),Math.max(0,music.getSelection().duration-musicClipDuration())));setMusicStatus('Press play to hear your selected music.');}
      catch(error){setMusicStatus(error.message||'Your selected track could not load.',true);}
      finally{musicBusy=false;}
    }
    restoringMusic=false;renderMusic();updateCounts();
  } catch(error) {
    els['preview-loading'].hidden=true;els['canvas-error'].hidden=false;els['canvas-error'].textContent='The original scans could not load. Please reload the studio.';
    els['download-label'].textContent='Reload to try again';setExportStatus(error.message,true);
  }
}
init();
