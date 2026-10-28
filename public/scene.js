import {prepareTemplate} from './template.js';

/** Deterministic search animation + crops of real website frames edited locally. */
const W=1080,H=1920,FPS=30;
const FRAMES_PER_CUT=3,CUT_COUNT=50,MONTAGE_DURATION=5;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const smooth=v=>{v=clamp(v,0,1);return v*v*(3-2*v);};
const fraction=v=>v-Math.floor(v);
const random=v=>fraction(Math.sin(v*12.9898+78.233)*43758.5453);

export function getSearchQuery(word='clarity'){
  // The form/API resolve the input prefix once; render that phrase verbatim.
  return String(word).trim();
}
function typingSchedule(word){
  const letters=Array.from(getSearchQuery(word));
  // Retain the approved Enter and montage boundaries for every input length.
  const gaps=[.055,.105,.042,.15,.067,.045,.21,.073,.04,.12,.052,.085,.036,.17,.065,.044,.09,.14,.05,.075,.035,.115];
  let at=1.05;
  letters.forEach((letter,i)=>{
    const gap=gaps[(i*7+letters.length)%gaps.length]+(letter===' '?.055:0)+(i>0&&i%13===0?.12:0);
    at+=gap;
  });
  const enter=Math.ceil((at+.36)*FPS)/FPS;
  const intro=Math.ceil((enter+.2)*FPS)/FPS;
  // Restore the original steady letter-by-letter rhythm in a stationary field.
  const start=.86,end=intro-.52;
  const typing=letters.map((_,i)=>start+(end-start)*(i+1)/letters.length);
  return {letters,typing,enter,intro};
}
export function getTiming(word='clarity'){
  const schedule=typingSchedule(String(word));
  return {fps:FPS,intro:schedule.intro,duration:schedule.intro+MONTAGE_DURATION,cutCount:CUT_COUNT,cutDuration:FRAMES_PER_CUT/FPS,framesPerCut:FRAMES_PER_CUT,montageDuration:MONTAGE_DURATION,click:.4,zoom:null,enter:schedule.enter};
}
export function getAudioEvents(word='clarity'){
  const schedule=typingSchedule(String(word));
  return {...getTiming(word),typing:schedule.typing,cuts:Array.from({length:CUT_COUNT},(_,i)=>schedule.intro+i*FRAMES_PER_CUT/FPS)};
}
export function getVisibleQuery(time,word='clarity'){
  const {letters,typing}=typingSchedule(String(word));
  let count=0;
  while(count<typing.length&&time>=typing[count])count++;
  return letters.slice(0,count).join('');
}
function canvas(w=W,h=H){
  if(typeof document==='undefined')return new OffscreenCanvas(w,h);
  const c=document.createElement('canvas');c.width=w;c.height=h;return c;
}
function noise(){
  const c=canvas(540,960),x=c.getContext('2d');
  for(let i=0;i<18000;i++){x.fillStyle=`rgba(42,40,25,${random(i)*.065})`;x.fillRect(random(i+6)*540,random(i+19)*960,.5+random(i+43)*1.3,.5+random(i+62)*1.3);}
  return c;
}
async function image(url){
  if(typeof Image==='undefined'){
    const response=await fetch(url);
    if(!response.ok)throw new Error('A video asset could not load.');
    return createImageBitmap(await response.blob());
  }
  return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('A captured website image could not load. Please prepare the sources again.'));img.crossOrigin='anonymous';img.src=url;});
}
export async function loadAssets(baseUrl='/',sources=[],word='find me clarity',{lazyTemplates=false}={}){
  const list=Array.isArray(sources)?sources:sources?.sources||[];
  const base=new URL(baseUrl,location.href);
  const prepare=async source=>{
    const anchor=source.anchor;
    if(!anchor||![anchor.x,anchor.y,anchor.width,anchor.height].every(Number.isFinite)||anchor.width<=0||anchor.height<=0)throw new Error('A captured page is missing the position of its real text.');
    const original=await image(new URL(source.image,base).href);
    const prepared=prepareTemplate({...source,img:original},word,canvas);
    if(prepared.img!==original){if(original.close)original.close();else original.src='';}
    return prepared;
  };
  const lazy=lazyTemplates&&list.every(source=>source.template);
  const sites=lazy?list.map(source=>({...source})):await Promise.all(list.map(prepare));
  const loading=new Map(),recent=new Map();
  const loadSite=async index=>{
    if(!lazy)return sites[index];
    if(!loading.has(index))loading.set(index,prepare(list[index]).then(site=>{
      sites[index]=site;recent.delete(index);recent.set(index,true);
      while(recent.size>4){const old=recent.keys().next().value;recent.delete(old);const img=sites[old].img;if(img?.close)img.close();else if(img){img.width=1;img.height=1;}sites[old]={...list[old]};loading.delete(old);}
      return site;
    }).catch(error=>{loading.delete(index);throw error;}));
    return loading.get(index);
  };
  const chromePhoto=await image(new URL('assets/chrome-photo-v7.png',base).href);
  return {sites,loadSite,chromePhoto,stage:canvas(),surface:canvas(),frame:canvas(),screen:canvas(),noise:noise()};
}
function fill(c,x,y,w,h,color){c.fillStyle=color;c.fillRect(x,y,w,h);}
function text(c,s,x,y,size,color='#424640',font='Arial',weight='400',align='left'){
  c.font=`${weight} ${size}px ${font}`;c.fillStyle=color;c.textAlign=align;c.textBaseline='alphabetic';c.fillText(s,x,y);
}
function line(c,x,y,xx,yy,color,width=1){c.beginPath();c.moveTo(x,y);c.lineTo(xx,yy);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
function round(c,x,y,w,h,r,background,stroke){c.beginPath();c.roundRect(x,y,w,h,r);if(background){c.fillStyle=background;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=2;c.stroke();}}
function google(c,x,y,size){
  const chars=['G','o','o','g','l','e'],colors=['#4f7bcd','#cb5e52','#d7ad48','#4f7bcd','#6f9360','#cb5e52'];
  c.font=`500 ${size}px Arial`;let xx=x-chars.reduce((n,s)=>n+c.measureText(s).width,0)/2;
  chars.forEach((s,i)=>{text(c,s,xx,y,size,colors[i],'Arial','500');xx+=c.measureText(s).width;});
}
function pointer(c,x,y,alpha=1){
  c.save();c.globalAlpha=alpha;c.translate(x,y);c.shadowColor='#0004';c.shadowBlur=5;c.beginPath();c.moveTo(0,0);c.lineTo(0,38);c.lineTo(11,28);c.lineTo(20,45);c.lineTo(28,41);c.lineTo(18,25);c.lineTo(34,21);c.closePath();c.fillStyle='#fff';c.fill();c.lineWidth=2.5;c.strokeStyle='#252c25';c.stroke();c.restore();
}
function chromeMark(c,x,y,r){
  c.save();c.translate(x,y);
  for(const [color,start,end] of [['#be655c',-Math.PI,0],['#c9ab62',0,Math.PI*2/3],['#788b68',Math.PI*2/3,Math.PI]]){
    c.beginPath();c.moveTo(0,0);c.arc(0,0,r,start,end);c.closePath();c.fillStyle=color;c.fill();
  }
  c.beginPath();c.arc(0,0,r*.48,0,Math.PI*2);c.fillStyle='#d4dedb';c.fill();
  c.beginPath();c.arc(0,0,r*.34,0,Math.PI*2);c.fillStyle='#5c818c';c.fill();c.restore();
}
function searchG(c,x,y,r){
  c.save();c.translate(x,y);c.lineWidth=r*.31;c.lineCap='butt';
  for(const [color,start,end] of [['#ba625a',205,315],['#c9ac62',150,205],['#758d6b',55,150],['#6284a4',-45,55]]){
    c.beginPath();c.arc(0,0,r,start*Math.PI/180,end*Math.PI/180);c.strokeStyle=color;c.stroke();
  }
  line(c,0,1,r+2,1,'#6284a4',r*.31);line(c,r+1,0,r+1,r*.48,'#6284a4',r*.28);c.restore();
}
function clockIcon(c,x,y,size=17){
  c.save();c.strokeStyle='#857c75';c.lineWidth=3.4;c.lineCap='round';c.beginPath();c.arc(x,y,size,Math.PI*.22,Math.PI*1.91);c.stroke();
  line(c,x,y,x,y-size*.55,'#857c75',3.1);line(c,x,y,x+size*.43,y+size*.22,'#857c75',3.1);
  line(c,x-size*.94,y-size*.43,x-size*1.05,y-size*.05,'#857c75',3);line(c,x-size*1.05,y-size*.05,x-size*.65,y-size*.09,'#857c75',3);c.restore();
}
function magnifier(c,x,y,size=14){
  c.save();c.beginPath();c.arc(x,y,size,0,Math.PI*2);c.strokeStyle='#7c7770';c.lineWidth=3.5;c.stroke();line(c,x+size*.72,y+size*.72,x+size*1.45,y+size*1.45,'#7c7770',3.5);c.restore();
}
function clippedText(c,value,x,y,maxWidth,size=43,color='#514c48',weight='400'){
  c.save();c.beginPath();c.rect(x,y-size-7,maxWidth,size+23);c.clip();text(c,value,x,y,size,color,'Arial',weight);c.restore();
}
function omniboxSuggestions(word,query){
  const full=getSearchQuery(word),clarity=/clarity/iu.test(word);
  const recent=clarity?['find clarity in life','how to clear your mind','clarity meaning','how to focus better']:[`${word} meaning`,`${word} ideas`,`how to learn about ${word}`,`${word} inspiration`];
  return query?[query,clarity?recent[0]:full,clarity?recent[1]:`${word} meaning`,clarity?recent[2]:`${word} ideas`]:recent;
}
function photoPage(c,time,word,assets){
  const photo=assets?.chromePhoto,events=getAudioEvents(word),query=getVisibleQuery(time,word);
  if(!photo){fill(c,0,0,W,H,'#69563d');return;}
  const focused=time>=events.click,pressed=time>=events.enter;
  // Two fixed camera framings. The first visible letter is a hard cut to 1.8x.
  const close=time>=events.typing[0],zoom=close?1.8:1;
  const scale=1.1,dx=-100,dy=360,queryX=584,queryY=494;
  const baseQueryX=dx+queryX*scale,baseQueryY=dy+queryY*scale;
  c.save();
  if(close){c.translate(190-baseQueryX*zoom,820-baseQueryY*zoom);c.scale(zoom,zoom);}
  c.translate(dx,dy);c.scale(scale,scale);
  c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';
  // Extend only the photographed wall and blank lower screen beyond the still's edges.
  // The photograph itself, its chrome, texture, perspective and grade remain untouched.
  c.drawImage(photo,4,4,photo.width-8,1,4,-600,photo.width-8,604);
  c.drawImage(photo,4,photo.height-5,photo.width-8,1,4,photo.height-5,photo.width-8,1200);
  // Omit the still's four-pixel player border without changing its registration.
  c.drawImage(photo,4,4,photo.width-8,photo.height-8,4,4,photo.width-8,photo.height-8);
  const bx=496,by=438,bw=1400,bh=89,tx=584,ty=494,rowHeight=77;
  const drop=focused&&!pressed,rows=omniboxSuggestions(word,query);
  if(focused){
    // Replace only the printed placeholder with a clean strip sampled below it.
    // Keeping the G and the original rounded field preserves the photographed UI.
    c.drawImage(photo,575,510,620,5,575,448,620,63);
    c.save();c.filter='blur(.45px)';
    round(c,bx,by,bw,bh,44,null,drop?'#a67c83':'#a98789');
    c.restore();
  }
  if(drop){
    c.save();c.filter='blur(.45px)';c.shadowColor='rgba(46,29,28,.25)';c.shadowBlur=14;c.shadowOffsetY=7;
    const bg=c.createLinearGradient(bx,by+bh,bx+900,by+bh+rowHeight*4);
    bg.addColorStop(0,'#c7b9b7');bg.addColorStop(1,'#bdb1af');
    round(c,bx,by+bh-3,bw,rowHeight*4+18,15,bg);
    c.shadowBlur=0;c.shadowOffsetY=0;
    // No reveal animation: clicking opens all four history/completion entries.
    for(let row=0;row<4;row++){
      const yy=by+bh+row*rowHeight;
      if(row===0&&query)round(c,bx+7,yy+5,bw-14,rowHeight-4,7,'#b9a9ac');
      if(row===0&&query)magnifier(c,bx+38,yy+38,9);else clockIcon(c,bx+38,yy+38,11);
      clippedText(c,rows[row],tx,yy+49,445,31,'#51484a');
      if(row===0&&query){
        c.font='400 31px Arial';const tail=tx+c.measureText(query).width+9;
        if(tail<tx+270)clippedText(c,'— Google Search',tail,yy+49,tx+460-tail,25,'#887b7e');
      }
    }
    c.restore();
  }
  if(focused){
    c.save();c.filter='blur(.42px)';c.beginPath();c.rect(tx-2,by+12,430,bh-21);c.clip();c.font='400 35px Arial';
    const measured=c.measureText(query).width,scroll=Math.max(0,measured-420);
    text(c,query,tx-scroll,ty,35,'#4c4346');
    if(!pressed&&(Math.floor(time*2.8)%2===0||time<1.1))fill(c,tx+measured-scroll+3,by+20,1.6,43,'#756369');
    c.restore();
    // A short inner shadow acknowledges the press without moving the camera.
    if(time<events.click+.12){
      const press=1-clamp((time-events.click)/.12,0,1);
      line(c,bx+43,by+3,bx+bw-43,by+3,`rgba(92,55,60,${press*.35})`,2.4);
    }
  }
  if(time<.76){
    const p=smooth(time/events.click),alpha=1-smooth((time-.56)/.2);
    c.save();c.filter='blur(.35px)';pointer(c,915+(660-915)*p,735+(483-735)*p,alpha);c.restore();
  }
  c.restore();
}
function radialTrail(c,surface,amount,alpha=.05){
  if(Math.abs(amount)<.002)return;
  c.save();
  for(let i=1;i<=7;i++){
    c.setTransform(1,0,0,1,0,0);c.translate(W/2,H/2);c.scale(1+amount*i/7,1+amount*i/7);c.globalAlpha=alpha*(1-i/12);c.drawImage(surface,-W/2,-H/2);
  }
  c.restore();
}
function grade(c,assets,opacity=1){
  c.save();c.globalAlpha=.25*opacity;if(assets?.noise)c.drawImage(assets.noise,0,0,W,H);c.restore();
  const light=c.createLinearGradient(0,0,W,H);light.addColorStop(0,'rgba(250,238,204,.025)');light.addColorStop(1,'rgba(33,46,25,.045)');fill(c,0,0,W,H,light);
  const vignette=c.createRadialGradient(540,960,520,540,960,1260);vignette.addColorStop(0,'rgba(26,31,19,0)');vignette.addColorStop(1,'rgba(26,31,19,.14)');fill(c,0,0,W,H,vignette);
}
function intro(c,time,word,assets,intensity){
  const surface=assets?.screen||canvas(),sc=surface.getContext('2d');sc.setTransform(1,0,0,1,0,0);photoPage(sc,time,word,assets);
  // The supplied still already carries the reference color and camera texture.
  c.drawImage(surface,0,0);
}
export function getCutAt(time){
  // Quantize to the rendered frame: every cut is exactly three 30-fps frames.
  const frame=clamp(Math.floor(time*FPS+1e-6),0,CUT_COUNT*FRAMES_PER_CUT-1);
  const index=Math.floor(frame/FRAMES_PER_CUT),frameInCut=frame%FRAMES_PER_CUT;
  return {index,frameInCut,local:frameInCut/FPS,duration:FRAMES_PER_CUT/FPS};
}
export function sourceIndexForCut(index,siteCount){
  if(siteCount<2)return 0;
  const pass=Math.floor(index/siteCount),local=index%siteCount;
  if(pass===0)return local;
  // New passes reverse/rotate the real pages rather than replay the same order.
  const direction=pass%2?-1:1;
  let offset=(pass*5+(direction<0?siteCount-1:0))%siteCount;
  const previous=sourceIndexForCut(pass*siteCount-1,siteCount);
  if(offset===previous)offset=(offset+1)%siteCount;
  return ((offset+direction*local)%siteCount+siteCount)%siteCount;
}
function missingSources(c,assets){
  fill(c,0,0,W,H,'#e9e9df');text(c,'Preparing website frames…',540,970,42,'#6d795f','Arial','400','center');
  text(c,'Your text will appear inside each sentence.',540,1036,27,'#919985','Arial','400','center');grade(c,assets);
}
function montage(c,time,assets,intensity){
  const sites=assets?.sites||[];
  if(!sites.length){missingSources(c,assets);return;}
  const {index,local,duration,frameInCut}=getCutAt(time),source=sites[sourceIndexForCut(index,sites.length)];
  if(!source.img){missingSources(c,assets);return;}
  const surface=assets.surface,sc=surface.getContext('2d');sc.setTransform(1,0,0,1,0,0);sc.clearRect(0,0,W,H);
  const a=source.anchor,centerX=a.x+a.width/2,centerY=a.y+a.height/2;
  // Crop each locally edited website screenshot around its inline phrase range.
  const goalHeight=55+(index%4)*3,baseScale=Math.min(goalHeight/a.height,850/a.width);
  const progress=clamp(local/duration,0,1),transition=frameInCut===0,mode=index%4;
  // One transition frame, followed by two sharp frames with the inline word fixed.
  const kick=transition?(mode===1?-.035:.035)*intensity:0;
  const scale=baseScale*(1+progress*.013+kick);
  const dx=540-centerX*scale,dy=960-centerY*scale;
  fill(sc,0,0,W,H,'#eeeee6');sc.save();sc.filter='saturate(.88) contrast(1.025)';sc.drawImage(source.img,dx,dy,source.img.width*scale,source.img.height*scale);sc.restore();
  // A translucent marker tracks the screenshot's exact text range.
  sc.save();sc.globalCompositeOperation='multiply';round(sc,540-a.width*scale/2-5,960-a.height*scale/2-3,a.width*scale+10,a.height*scale+6,3,'rgba(219,205,108,.29)');sc.restore();
  grade(sc,assets,.7);
  if(transition&&mode===2){c.save();c.filter=`blur(${2.7*intensity}px)`;c.drawImage(surface,0,0);c.restore();}
  else c.drawImage(surface,0,0);
  if(transition){
    const smear=(mode===1?-.18:mode===3?.25:.19)*intensity;
    radialTrail(c,surface,smear,mode===3?.075:.055);
  }
  const domain=source.domain||new URL(source.url).hostname;
  c.save();c.font='400 22px Arial';const width=Math.min(740,c.measureText(domain).width+42);
  round(c,(W-width)/2,H-112,width,45,22,'rgba(241,242,234,.87)');text(c,domain,540,H-82,22,'#7c8770','Arial','400','center');c.restore();
}
let fallbackAssets;
export function drawScene(ctx,{time=0,word='clarity',width=W,height=H,assets,intensity=.75}={}){
  const s=String(word),timing=getTiming(s),t=clamp(Number(time)||0,0,timing.duration-1/FPS);
  if(!assets)assets=fallbackAssets||(fallbackAssets={stage:canvas(),screen:canvas(),surface:canvas(),frame:canvas(),noise:noise(),sites:[]});
  const c=assets.stage.getContext('2d');c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,W,H);
  if(t<timing.intro)intro(c,t,s,assets,clamp(intensity,0,1));else montage(c,t-timing.intro,assets,clamp(intensity,0,1));
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,width,height);ctx.drawImage(assets.stage,0,0,width,height);ctx.restore();
}
