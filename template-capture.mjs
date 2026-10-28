/** One-time website background preparation. Runtime videos never revisit these sites. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, rename, access} from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import {placeInParagraph, verifyPlacementVisible} from './source-capture.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const OUT=path.join(ROOT,'public/templates/v1');
const CHROME=process.env.WORD_STUDIO_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WORD='find me clarity',VERSION='reusable-web-v1';
const digest=value=>createHash('sha256').update(value).digest('hex').slice(0,18);
const siteKey=hostname=>hostname.toLowerCase().replace(/^www\./u,'');
const validUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};

async function paragraphTemplate(page){
  return page.evaluate(()=>{
    const span=document.querySelector('[data-wordrush-inserted]');
    const p=span?.closest('p,[role="paragraph"]');
    if(!p||p.querySelector('img,svg,canvas,iframe,video,table,input,button'))throw new Error('Paragraph includes unsupported embedded content');
    const style=getComputedStyle(p),r=p.getBoundingClientRect();
    if(style.writingMode!=='horizontal-tb'||style.direction!=='ltr'||!['start','left','justify'].includes(style.textAlign))throw new Error('Paragraph uses unsupported text flow');
    const before=document.createRange();before.selectNodeContents(p);before.setEndBefore(span);
    const after=document.createRange();after.selectNodeContents(p);after.setStartAfter(span);
    const clean=value=>value.replace(/\s+/gu,' ').trim();
    const prefix=clean(before.toString()),suffix=clean(after.toString());
    if(prefix.length<25||suffix.length<25)throw new Error('Not enough sentence context');
    const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let first;
    while((first=walker.nextNode()))if(first.textContent.trim())break;
    if(!first)throw new Error('No paragraph text');
    const firstRange=document.createRange();const start=first.textContent.search(/\S/u);firstRange.setStart(first,start);firstRange.setEnd(first,start+1);
    const firstRect=firstRange.getBoundingClientRect();
    const firstStyle=getComputedStyle(first.parentElement);
    const size=parseFloat(style.fontSize),lineHeight=parseFloat(style.lineHeight)||size*1.2;
    if(size<12||lineHeight<size||lineHeight>size*2.4||r.width<260||r.height>800)throw new Error('Paragraph geometry unsuitable for reusable text');
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    ctx.font=`${firstStyle.fontStyle} ${firstStyle.fontWeight} ${firstStyle.fontSize} ${firstStyle.fontFamily}`;
    const metrics=ctx.measureText(first.textContent.slice(start,start+1));
    const ascent=metrics.fontBoundingBoxAscent||size*.9;
    const contentX=r.x+parseFloat(style.borderLeftWidth)+parseFloat(style.paddingLeft);
    const contentY=r.y+parseFloat(style.borderTopWidth)+parseFloat(style.paddingTop);
    const contentWidth=r.width-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-parseFloat(style.borderLeftWidth)-parseFloat(style.borderRightWidth);
    const contentHeight=r.height-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom)-parseFloat(style.borderTopWidth)-parseFloat(style.borderBottomWidth);
    const letterSpacing=style.letterSpacing==='normal'?0:parseFloat(style.letterSpacing)||0;
    const paragraph={x:contentX,y:contentY,width:contentWidth,height:contentHeight,fontFamily:style.fontFamily,fontSize:size,fontWeight:style.fontWeight,fontStyle:style.fontStyle,color:style.color,lineHeight,letterSpacing,textAlign:style.textAlign,textTransform:style.textTransform,textIndent:parseFloat(style.textIndent)||0,baselineOffset:firstRect.y+ascent-contentY,whiteSpace:style.whiteSpace};
    p.dataset.wordrushTemplate='true';
    const css=document.createElement('style');css.dataset.wordrushTemplateHide='true';css.textContent='[data-wordrush-template], [data-wordrush-template] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }';document.head.append(css);
    return {before:prefix,after:suffix,paragraph,originalText:clean(p.innerText),originalPhrase:span.textContent};
  });
}

async function captureTemplate(browser,url){
  const page=await browser.newPage();
  try{
    await page.setViewport({width:1440,height:2200,deviceScaleFactor:1});
    page.setDefaultTimeout(12000);
    await page.setRequestInterception(true);
    page.on('request',request=>{
      if(request.resourceType()==='media'||/doubleclick\.net|googlesyndication\.com|google-analytics\.com|facebook\.net/iu.test(request.url()))void request.abort().catch(()=>{});
      else void request.continue().catch(()=>{});
    });
    const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:14000});
    if(!response||response.status()>=400)throw new Error(`HTTP ${response?.status()||'unavailable'}`);
    await page.waitForNetworkIdle({idleTime:150,timeout:1600}).catch(()=>{});
    await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,1600))]));
    const blocked=await page.evaluate(()=>/just a moment|verify you are human|attention required|access denied|captcha|checking your browser/iu.test(document.title)||/verify you are human|please enable javascript and cookies to continue/iu.test((document.body?.innerText||'').slice(0,1000)));
    if(blocked)throw new Error('Site requires verification');
    const seed=parseInt(digest(`${WORD}:${url}`).slice(0,8),16);
    const placed=await placeInParagraph(page,WORD,seed);
    if(!placed)throw new Error('No suitable prose paragraph');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.waitForNetworkIdle({idleTime:150,timeout:800}).catch(()=>{});
    const checked=await verifyPlacementVisible(page,WORD,{dismissPromotions:true});
    if(!checked.visible)throw new Error(checked.error);
    const finalUrl=validUrl(page.url());if(!finalUrl)throw new Error('Unsupported redirect');
    const template=await paragraphTemplate(page);
    const id=digest(`${VERSION}:${finalUrl}`),filename=`${id}.jpg`;
    await page.screenshot({path:path.join(OUT,filename),type:'jpeg',quality:94,fullPage:false,timeout:12000});
    return {id,version:VERSION,mode:'reusable-template',localEditsOnly:true,screenshotEdited:true,domain:siteKey(new URL(finalUrl).hostname),url:finalUrl,sourceURL:finalUrl,title:placed.title,image:`/templates/v1/${filename}`,viewport:{width:1440,height:2200},anchor:checked.anchor,fontSize:placed.fontSize,template,preparedAt:new Date().toISOString()};
  }finally{await page.close().catch(()=>{});}
}

export async function prepareTemplates({targetCount=50,onProgress=console.log}={}){
  await mkdir(OUT,{recursive:true});
  const baseline=JSON.parse(await readFile(path.join(ROOT,'public/captures/placed-v3/95f9f80a379be2dd8395/manifest.json'),'utf8'));
  const catalog=JSON.parse(await readFile(path.join(ROOT,'source-sites.json'),'utf8'));
  const raw=Array.isArray(catalog)?catalog:catalog.sites||[];
  const urls=[...new Set([...baseline.sources.map(s=>s.url),...raw.map(s=>typeof s==='string'?s:s.url)].map(validUrl).filter(Boolean))];
  const manifest={version:VERSION,mode:'reusable-template',preparedOnce:true,runtimeWebsiteRequests:0,wordIndependent:true,targetCount,sources:[],failures:[],createdAt:new Date().toISOString()};
  try{
    const prior=JSON.parse(await readFile(path.join(OUT,'manifest.json'),'utf8'));
    for(const source of prior.sources||[])try{await access(path.join(OUT,path.basename(source.image)));manifest.sources.push(source);}catch{}
  }catch{}
  const domains=new Set(manifest.sources.map(s=>s.domain));
  const save=async()=>{manifest.complete=domains.size>=targetCount;manifest.distinctSites=domains.size;manifest.updatedAt=new Date().toISOString();const tmp=path.join(OUT,'manifest.json.tmp');await writeFile(tmp,JSON.stringify(manifest,null,2));await rename(tmp,path.join(OUT,'manifest.json'));};
  let chain=Promise.resolve();const persist=()=>chain=chain.then(save);
  if(domains.size>=targetCount)return manifest;
  const browser=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--disable-background-networking','--disable-component-update','--disable-features=Translate','--no-first-run','--no-default-browser-check'],timeout:20000,protocolTimeout:18000});
  let cursor=0,attempted=0;
  try{
    const worker=async()=>{
      while(cursor<urls.length&&domains.size<targetCount){
        const url=urls[cursor++],domain=siteKey(new URL(url).hostname);
        if(domains.has(domain))continue;
        try{
          const source=await captureTemplate(browser,url);
          if(!domains.has(source.domain)&&domains.size<targetCount){domains.add(source.domain);manifest.sources.push(source);await persist();}
        }catch(error){manifest.failures.push({url,error:String(error.message||error).slice(0,200)});}
        attempted++;onProgress({completed:domains.size,target:targetCount,attempted,url});
      }
    };
    await Promise.all([worker(),worker(),worker()]);
  }finally{await browser.close().catch(()=>{});await persist();}
  return manifest;
}
if(process.argv[1]===fileURLToPath(import.meta.url))prepareTemplates().then(m=>console.log(JSON.stringify({complete:m.complete,count:m.sources.length,path:path.join(OUT,'manifest.json')}))).catch(error=>{console.error(error);process.exitCode=1;});
