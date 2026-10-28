import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir, readFile, writeFile, access, rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {parsePhrase} from './public/phrase.js';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const VERSION='placed-web-v3',MODE='placed';
const VIEWPORT={width:1440,height:2200,deviceScaleFactor:1};
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const digest=value=>createHash('sha256').update(value).digest('hex').slice(0,18);
const siteKey=hostname=>{const parts=hostname.toLowerCase().replace(/^www\./u,'').split('.');return parts.slice(-(/^(?:co|com|org|ac|gov|edu)\.[a-z]{2}$/u.test(parts.slice(-2).join('.'))?3:2)).join('.');};
function publicUrl(raw){try{const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.includes('.')||/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/u.test(url.hostname)||/\.(?:pdf|zip|mp4|png|jpe?g|gif)(?:$|\?)/iu.test(url.pathname))return null;url.hash='';return url.href;}catch{return null;}}

/** Local DOM placement only. This never publishes changes to the source website. */
export async function placeInParagraph(page,word,seed){
  return page.evaluate(({target,seedValue})=>{
    let state=seedValue>>>0;
    const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
    const isExcluded=element=>element.closest('nav,header,footer,form,button,h1,h2,h3,h4,h5,h6,blockquote,q,cite,pre,code,aside,[role="navigation"],[role="dialog"],[aria-modal="true"],[hidden],nav,[class~="menu"],[class~="navigation"],[class~="breadcrumb"],[id^="onetrust"],[id^="CybotCookiebot"],[class*="cookie-banner"],[class*="consent-banner"]');
    const candidates=[];
    for(const paragraph of document.querySelectorAll('p,[role="paragraph"]')){
      if(isExcluded(paragraph)||paragraph.querySelector('[data-wordrush-inserted]'))continue;
      const original=(paragraph.innerText||'').replace(/\s+/gu,' ').trim();
      if(original.length<180||original.length>2000||/privacy policy|cookie policy|terms of service|all rights reserved|sign up for|subscribe to our/iu.test(original))continue;
      const pStyle=getComputedStyle(paragraph),pRect=paragraph.getBoundingClientRect();
      if(pStyle.visibility==='hidden'||pStyle.display==='none'||Number(pStyle.opacity)===0||Number.parseFloat(pStyle.fontSize)<12||pRect.width<260||pRect.height<16)continue;
      const links=[...paragraph.querySelectorAll('a')].reduce((n,a)=>n+(a.innerText||'').length,0);
      if(links/original.length>.45)continue;
      const walker=document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT);let node;
      while((node=walker.nextNode())){
        if(!node.parentElement||isExcluded(node.parentElement)||node.parentElement.closest('a,strong,b,em,i,small,sub,sup,script,style'))continue;
        const value=node.textContent||'';
        const tokens=[...value.matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)];
        if(tokens.length<10||value.trim().length<65)continue;
        // Use a middle token span inside one sentence, with visible prose on either side.
        const segments=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(value)]:[{index:0,segment:value}];
        for(const sentence of segments){
          const sentenceStart=sentence.index,sentenceEnd=sentenceStart+sentence.segment.length;
          const words=tokens.filter(t=>t.index>=sentenceStart&&t.index+t[0].length<=sentenceEnd);
          if(words.length<10)continue;
          const lower=Math.max(3,Math.floor(words.length*.3)),upper=Math.min(words.length-5,Math.ceil(words.length*.65));
          if(upper<lower)continue;
          const startWord=lower+Math.floor(random()*(upper-lower+1));
          const replaceCount=Math.min(3,Math.max(1,Array.from(target.trim().split(/\s+/u)).length),words.length-startWord-3);
          const start=words[startWord].index,end=words[startWord+replaceCount-1].index+words[startWord+replaceCount-1][0].length;
          if(value.slice(sentenceStart,start).trim().length<12||value.slice(end,sentenceEnd).trim().length<12)continue;
          const before=document.createRange();before.setStart(paragraph,0);before.setEnd(node,start);
          const after=document.createRange();after.setStart(node,end);after.setEnd(paragraph,paragraph.childNodes.length);
          const prefix=before.toString().replace(/\s+/gu,' ').trim(),suffix=after.toString().replace(/\s+/gu,' ').trim();
          if(prefix.length<25||suffix.length<25)continue;
          const inArticle=paragraph.closest('article,main,[role="main"],.mw-parser-output,#content')?15:0;
          const score=inArticle+Math.min(original.length,700)/100+random()*8-Math.abs(pRect.width-800)/300;
          candidates.push({paragraph,node,start,end,original,originalSpan:value.slice(start,end),prefix,suffix,score});
        }
      }
    }
    candidates.sort((a,b)=>b.score-a.score);
    for(const selected of candidates.slice(0,35)){
      const paragraph=selected.paragraph;
      paragraph.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      const range=document.createRange();range.setStart(selected.node,selected.start);range.setEnd(selected.node,selected.end);
      const box=range.getBoundingClientRect();
      window.scrollBy({top:box.y+box.height/2-window.innerHeight/2,left:0,behavior:'instant'});
      const current=range.getBoundingClientRect();
      const at=document.elementFromPoint(Math.max(0,Math.min(window.innerWidth-1,current.x+current.width/2)),Math.max(0,Math.min(window.innerHeight-1,current.y+current.height/2)));
      if(at&&!paragraph.contains(at)&&!at.contains(paragraph))continue;
      const span=document.createElement('span');span.dataset.wordrushInserted='true';span.textContent=target;
      span.style.whiteSpace='nowrap';span.style.fontWeight='400';span.style.fontStyle='normal';
      range.deleteContents();range.insertNode(span);
      const insertedRange=document.createRange();insertedRange.selectNodeContents(span);
      const inserted=insertedRange.getBoundingClientRect();
      window.scrollBy({top:inserted.y+inserted.height/2-window.innerHeight/2,left:0,behavior:'instant'});
      const anchor=insertedRange.getBoundingClientRect();
      return {originalParagraph:selected.original,editedParagraph:(paragraph.innerText||'').replace(/\s+/gu,' ').trim(),originalSpan:selected.originalSpan,insertedText:target,contextBefore:selected.prefix.slice(-105),contextAfter:selected.suffix.slice(0,155),excerpt:`${selected.prefix.slice(-105)} ${target} ${selected.suffix.slice(0,155)}`.replace(/\s+/gu,' '),anchor:{x:anchor.x,y:anchor.y,width:anchor.width,height:anchor.height},fontSize:Number.parseFloat(getComputedStyle(span).fontSize),title:document.title,paragraphTag:paragraph.tagName};
    }
    return null;
  },{target:word,seedValue:seed});
}

export async function verifyPlacementVisible(page,word,{dismissPromotions=false}={}){
  return page.evaluate(({target,mayDismiss})=>{
    const span=document.querySelector('[data-wordrush-inserted]');
    if(!span||span.textContent!==target)return {visible:false,error:'The locally placed text is missing'};
    const paragraph=span.closest('p,[role="paragraph"]');
    const dismissed=[];
    for(let pass=0;pass<8;pass++){
      const range=document.createRange();range.selectNodeContents(span);
      const box=range.getBoundingClientRect();
      window.scrollBy({top:box.y+box.height/2-window.innerHeight/2,left:0,behavior:'instant'});
      const a=range.getBoundingClientRect();
      if(a.width<=0||a.height<=0||a.x+a.width/2<0||a.x+a.width/2>=innerWidth||a.y+a.height/2<0||a.y+a.height/2>=innerHeight)return {visible:false,error:'The placed text is outside the viewport'};
      const probes=[.15,.5,.85].map(position=>document.elementFromPoint(a.x+a.width*position,a.y+a.height/2));
      const coveredIndex=probes.findIndex(element=>!element||!(element===span||span.contains(element)||paragraph?.contains(element)));
      if(coveredIndex<0)return {visible:true,anchor:{x:a.x,y:a.y,width:a.width,height:a.height},insertedText:span.textContent,dismissedPromotions:dismissed};
      const cover=probes[coveredIndex];
      if(!cover)return {visible:false,error:'Part of the placed text is outside the viewport'};
      if(!mayDismiss)return {visible:false,error:'A page overlay covers the placed text'};
      let promotion;
      for(let element=cover;element&&element!==document.body&&element!==document.documentElement;element=element.parentElement){
        if(element.contains(paragraph))continue;
        const style=getComputedStyle(element),label=`${element.id} ${typeof element.className==='string'?element.className:''} ${(element.innerText||'').slice(0,1800)}`;
        const overlay=style.position==='fixed'||element.getAttribute('role')==='dialog'||element.getAttribute('aria-modal')==='true'||/modal|popup|pop-up|overlay|backdrop/iu.test(label);
        const isAccessGate=/paywall|captcha|verify.{0,30}human|subscribe to (?:read|continue)|subscriber.only|sign in to continue|unlock.{0,20}article|purchase access/iu.test(label);
        const isPromotion=/betterhelp|newsletter|subscribe|special offer|limited.time|advertis|marketing|join our|discount/iu.test(label);
        const isDismissedBackdrop=dismissed.length>0&&/backdrop|overlay/iu.test(label)&&style.position==='fixed';
        if(overlay&&!isAccessGate&&(isPromotion||isDismissedBackdrop))promotion=element;
      }
      if(!promotion)return {visible:false,error:'A page overlay covers the placed text'};
      dismissed.push({tag:promotion.tagName,id:promotion.id,className:typeof promotion.className==='string'?promotion.className:''});
      promotion.style.setProperty('display','none','important');
      promotion.setAttribute('data-wordrush-dismissed-promotion','true');
    }
    return {visible:false,error:'The placed text remains covered by a page overlay'};
  },{target:word,mayDismiss:dismissPromotions});
}

async function capturePage(browser,url,word,outputDir,publicBaseUrl){
  const page=await browser.newPage();
  try{
    await page.setViewport(VIEWPORT);page.setDefaultTimeout(12000);
    await page.setRequestInterception(true);
    page.on('request',request=>{
      if(request.resourceType()==='media'||/doubleclick\.net|googlesyndication\.com|google-analytics\.com|facebook\.net/iu.test(request.url()))void request.abort().catch(()=>{});
      else void request.continue().catch(()=>{});
    });
    const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:12000});
    if(!response||response.status()>=400)throw new Error(`HTTP ${response?.status()||'unavailable'}`);
    await page.waitForNetworkIdle({idleTime:150,timeout:1800}).catch(()=>{});
    await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,1800))])).catch(()=>{});
    const blocked=await page.evaluate(()=>/just a moment|verify you are human|attention required|access denied|captcha|checking your browser/iu.test(document.title)||/verify you are human|please enable javascript and cookies to continue/iu.test((document.body?.innerText||'').slice(0,1000)));
    if(blocked)throw new Error('Site requires verification');
    const seed=Number.parseInt(digest(`${word}:${url}`).slice(0,8),16);
    const placed=await placeInParagraph(page,word,seed);
    if(!placed)throw new Error('No visible prose paragraph suitable for local text placement');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.waitForNetworkIdle({idleTime:150,timeout:900}).catch(()=>{});
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,350)));
    const finalUrl=publicUrl(page.url());if(!finalUrl)throw new Error('Site redirected away from a public page');
    const id=digest(`${finalUrl}:${word}:${VERSION}`),filename=`${id}.jpg`;
    let final;const dismissedPromotions=[];
    for(let attempt=0;attempt<3;attempt++){
      final=await verifyPlacementVisible(page,word,{dismissPromotions:true});
      if(!final.visible)throw new Error(final.error);
      dismissedPromotions.push(...final.dismissedPromotions);
      await page.screenshot({path:path.join(outputDir,filename),type:'jpeg',quality:92,fullPage:false,timeout:12000});
      const after=await verifyPlacementVisible(page,word);
      if(after.visible&&Math.abs(after.anchor.x-final.anchor.x)<1&&Math.abs(after.anchor.y-final.anchor.y)<1)break;
      if(attempt===2)throw new Error('The page changed or covered the phrase while capturing');
    }
    return {id,version:VERSION,mode:MODE,localEditsOnly:true,screenshotEdited:true,domain:siteKey(new URL(finalUrl).hostname),hostname:new URL(finalUrl).hostname,url:finalUrl,sourceURL:finalUrl,image:`${publicBaseUrl.replace(/\/$/u,'')}/${filename}`,viewport:{width:VIEWPORT.width,height:VIEWPORT.height},...placed,anchor:final.anchor,matchedText:word,occlusionChecked:true,dismissedPromotions,capturedAt:new Date().toISOString()};
  }finally{await page.close().catch(()=>{});}
}

/** Repair one cached frame without recapturing the other websites. */
export async function recaptureSource(word,{url,outputDir,publicBaseUrl}={}){
  const parsed=parsePhrase(word,{stripPrefix:false});if(parsed.error)throw new Error(parsed.error);word=parsed.phrase;
  const address=publicUrl(url);if(!address||!outputDir||typeof word!=='string'||!word.trim())throw new Error('A public page, text, and output folder are required.');
  await mkdir(outputDir,{recursive:true});
  const browser=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--disable-background-networking','--disable-component-update','--disable-features=Translate','--no-first-run','--no-default-browser-check'],timeout:20000,protocolTimeout:18000});
  try{return await capturePage(browser,address,word,outputDir,publicBaseUrl);}finally{await browser.close().catch(()=>{});}
}

/** Capture edited versions of actual public pages. The original website is not modified. */
export async function prepareSources(word,{outputDir,publicBaseUrl='/captures/placed-v3/',onProgress=()=>{},targetCount=50,maxCandidates=145}={}){
  const parsed=parsePhrase(word,{stripPrefix:false});if(parsed.error)throw new Error(parsed.error);word=parsed.phrase;
  if(!outputDir)throw new Error('A source output folder is required.');
  await mkdir(outputDir,{recursive:true});
  const manifestPath=path.join(outputDir,'manifest.json');
  let previousSources=[];
  try{
    const prior=JSON.parse(await readFile(manifestPath,'utf8'));
    if(prior.word===word&&prior.mode===MODE&&prior.version===VERSION&&Array.isArray(prior.sources)){
      const checked=await Promise.all(prior.sources.filter(s=>s.mode===MODE&&s.insertedText===word).map(async s=>{try{await access(path.join(outputDir,path.basename(s.image)));return {...s,image:`${publicBaseUrl.replace(/\/$/u,'')}/${path.basename(s.image)}`};}catch{return null;}}));
      previousSources=checked.filter(Boolean);
      if(new Set(previousSources.map(s=>s.domain)).size>=targetCount)return {...prior,sources:previousSources,complete:true};
    }
  }catch{}
  const catalog=JSON.parse(await readFile(path.join(ROOT,'source-sites.json'),'utf8'));
  const raw=Array.isArray(catalog)?catalog:catalog.sites||[];
  const candidates=[...new Set(raw.map(s=>publicUrl(typeof s==='string'?s:s.url)).filter(Boolean))].slice(0,maxCandidates);
  const manifest={version:VERSION,mode:MODE,word,createdAt:new Date().toISOString(),sources:previousSources,failures:[],attempted:0,requestedDistinctSites:targetCount,discovery:{provider:'Fixed public website catalog; local DOM text placement',catalogCount:candidates.length,noWordSearch:true}};
  const persist=async()=>{manifest.distinctSites=new Set(manifest.sources.map(s=>s.domain)).size;manifest.complete=manifest.distinctSites>=targetCount;manifest.updatedAt=new Date().toISOString();const temp=`${manifestPath}.tmp`;await writeFile(temp,JSON.stringify(manifest,null,2));await rename(temp,manifestPath);};
  let persistQueue=Promise.resolve();const save=()=>{persistQueue=persistQueue.then(persist);return persistQueue;};
  onProgress({stage:'Preparing edited website frames',completed:manifest.sources.length,target:targetCount,attempted:0,progress:manifest.sources.length/targetCount});
  const browser=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--disable-background-networking','--disable-component-update','--disable-features=Translate','--no-first-run','--no-default-browser-check'],timeout:20000,protocolTimeout:18000});
  const domains=new Set(previousSources.map(s=>s.domain));let cursor=0;
  try{
    const worker=async()=>{
      while(cursor<candidates.length&&manifest.sources.length<targetCount){
        const url=candidates[cursor++],domain=siteKey(new URL(url).hostname);if(domains.has(domain))continue;
        try{
          const source=await capturePage(browser,url,word,outputDir,publicBaseUrl);
          if(!domains.has(source.domain)&&manifest.sources.length<targetCount){domains.add(source.domain);manifest.sources.push(source);await save();}
        }catch(error){manifest.failures.push({url,error:String(error.message||error).slice(0,200)});}
        manifest.attempted++;
        onProgress({stage:`Placing your text · ${manifest.sources.length}/${targetCount} websites`,completed:manifest.sources.length,target:targetCount,attempted:manifest.attempted,progress:Math.min(1,manifest.sources.length/targetCount)});
      }
    };
    await Promise.all([worker(),worker(),worker(),worker()]);
  }finally{await browser.close().catch(()=>{});await save();}
  return manifest;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const parsed=parsePhrase(process.argv[2]||'find me clarity');
  if(parsed.error){console.error(parsed.error);process.exit(1);}
  const word=parsed.phrase,key=createHash('sha256').update(word).digest('hex').slice(0,20),outputDir=path.resolve(process.argv[3]||path.join(ROOT,'public','captures','placed-v3',key));
  prepareSources(word,{outputDir,publicBaseUrl:`http://127.0.0.1:4321/captures/placed-v3/${key}/`,onProgress:state=>console.log(JSON.stringify(state))}).then(m=>console.log(JSON.stringify({outputDir,count:m.sources.length,complete:m.complete,domains:m.sources.map(s=>s.domain)}))).catch(error=>{console.error(error);process.exitCode=1;});
}
