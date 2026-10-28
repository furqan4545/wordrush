/** Deterministic search animation + crops of real website frames edited locally. */
const W=1080,H=1920,FPS=30;
const FRAMES_PER_CUT=3,CUT_COUNT=50,MONTAGE_DURATION=5;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const smooth=v=>{v=clamp(v,0,1);return v*v*(3-2*v);};
const fraction=v=>v-Math.floor(v);
const random=v=>fraction(Math.sin(v*12.9898+78.233)*43758.5453);

export function getSearchQuery(word='clarity'){
  const value=String(word);
  return /^find me\s/iu.test(value)?value:`how do i find ${value}`;
}
function typingSchedule(word){
  const letters=Array.from(getSearchQuery(word));
  const gaps=[.055,.105,.042,.15,.067,.045,.21,.073,.04,.12,.052,.085,.036,.17,.065,.044,.09,.14,.05,.075,.035,.115];
  let at=1.05;
  const typing=letters.map((letter,i)=>{
    const gap=gaps[(i*7+letters.length)%gaps.length]+(letter===' '?.055:0)+(i>0&&i%13===0?.12:0);
    at+=gap;
    return Math.round(at*FPS)/FPS;
  });
  const enter=Math.ceil((at+.36)*FPS)/FPS;
  const intro=Math.ceil((enter+.2)*FPS)/FPS;
  return {letters,typing,enter,intro};
}
export function getTiming(word='clarity'){
  const schedule=typingSchedule(String(word));
  return {fps:FPS,intro:schedule.intro,duration:schedule.intro+MONTAGE_DURATION,cutCount:CUT_COUNT,cutDuration:FRAMES_PER_CUT/FPS,framesPerCut:FRAMES_PER_CUT,montageDuration:MONTAGE_DURATION,click:.4,zoom:.52,enter:schedule.enter};
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
function canvas(w=W,h=H){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function noise(){
  const c=canvas(540,960),x=c.getContext('2d');
  for(let i=0;i<18000;i++){x.fillStyle=`rgba(42,40,25,${random(i)*.065})`;x.fillRect(random(i+6)*540,random(i+19)*960,.5+random(i+43)*1.3,.5+random(i+62)*1.3);}
  return c;
}
async function image(url){
  return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('A captured website image could not load. Please prepare the sources again.'));img.crossOrigin='anonymous';img.src=url;});
}
export async function loadAssets(baseUrl='/',sources=[]){
  const list=Array.isArray(sources)?sources:sources?.sources||[];
  const base=new URL(baseUrl,location.href);
  const sites=await Promise.all(list.map(async source=>{
    const anchor=source.anchor;
    if(!anchor||![anchor.x,anchor.y,anchor.width,anchor.height].every(Number.isFinite)||anchor.width<=0||anchor.height<=0)throw new Error('A captured page is missing the position of its real text.');
    return {...source,img:await image(new URL(source.image,base).href)};
  }));
  return {sites,stage:canvas(),surface:canvas(),frame:canvas(),screen:canvas(),noise:noise()};
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
function googlePage(c,time,word){
  const events=getAudioEvents(word),query=getVisibleQuery(time,word);
  fill(c,0,0,W,H,'#ecebe4');
  fill(c,0,0,W,72,'#dddeda');line(c,0,72,W,72,'#c5c9c0');
  text(c,'‹   ›   ↻',34,44,24,'#767d72');round(c,186,14,713,43,20,'#e9eae4');text(c,'google.com',222,44,23,'#747e6f');
  text(c,'Gmail    Images    ⠿',805,136,22,'#69715f');
  google(c,540,663,125);
  const clicked=time>=events.click,pressed=time>=events.enter;
  c.save();c.shadowColor=clicked?'rgba(66,81,52,.17)':'rgba(62,69,53,.09)';c.shadowBlur=clicked?15:8;c.shadowOffsetY=3;
  round(c,74,810,932,114,57,pressed?'#dfe4d4':'#f5f4ec',clicked?'#a5b198':'#c4c9bc');c.restore();
  c.beginPath();c.arc(116,866,13,0,Math.PI*2);c.strokeStyle='#8d9584';c.lineWidth=3.5;c.stroke();line(c,125,876,137,888,'#8d9584',3.5);
  // After the camera moves into the search field, the entire query remains visible.
  c.font='400 43px Arial';
  const full=getSearchQuery(word),size=Math.min(43,43*550/Math.max(1,c.measureText(full).width));
  c.font=`400 ${size}px Arial`;text(c,query,154,882,size,'#303b2e');
  if(clicked&&!pressed&&(Math.floor(time*2.8)%2===0||time<1.1)){
    const end=154+c.measureText(query).width;fill(c,end+3,882-size*.85,2.3,size*1.05,'#6d7f5a');
  }
  line(c,922,851,922,876,'#6d8770',5);c.beginPath();c.arc(922,873,11,0,Math.PI);c.strokeStyle='#6d8770';c.lineWidth=3;c.stroke();line(c,922,886,922,892,'#6d8770',3);
  round(c,951,852,23,23,5,null,'#7f8d75');
  round(c,302,978,217,57,5,'#e2e5da');round(c,538,978,243,57,5,'#e2e5da');
  text(c,'Google Search',411,1015,23,'#66715e','Arial','400','center');text(c,'I’m Feeling Lucky',659,1015,23,'#66715e','Arial','400','center');
  text(c,'Google offered in:  English',540,1123,20,'#7d896f','Arial','400','center');
  if(time<.76){const p=smooth(time/.4);pointer(c,810+(154-810)*p,1190+(861-1190)*p,1-smooth((time-.56)/.2));}
  if(time>=events.click&&time<events.click+.16){const p=(time-events.click)/.16;c.beginPath();c.arc(154,867,15+p*35,0,Math.PI*2);c.strokeStyle=`rgba(124,144,95,${(1-p)*.3})`;c.lineWidth=3;c.stroke();}
  if(pressed){const p=clamp((time-events.enter)/.13,0,1);fill(c,154,912,790*p,2,'#92a574');}
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
  const surface=assets?.screen||canvas(),sc=surface.getContext('2d');sc.setTransform(1,0,0,1,0,0);googlePage(sc,time,word);
  const events=getAudioEvents(word),rush=smooth((time-.52)/.32),z=1+.55*rush;
  const tx=(120-154*z)*rush,ty=(960-867*z)*rush;
  fill(c,0,0,W,H,'#e9e9e0');c.save();c.translate(tx,ty);c.scale(z,z);c.drawImage(surface,0,0);c.restore();
  const blur=Math.sin(clamp((time-.52)/.32,0,1)*Math.PI)*.24*intensity;
  if(blur>.001){const f=assets?.frame||canvas(),fc=f.getContext('2d');fc.setTransform(1,0,0,1,0,0);fc.clearRect(0,0,W,H);fc.drawImage(c.canvas,0,0);radialTrail(c,f,blur,.075);}
  const exit=clamp((time-events.enter)/Math.max(.01,events.intro-events.enter),0,1);
  if(exit>0){const f=assets?.frame||canvas(),fc=f.getContext('2d');fc.setTransform(1,0,0,1,0,0);fc.clearRect(0,0,W,H);fc.drawImage(c.canvas,0,0);radialTrail(c,f,exit*exit*.35*intensity,.08);}
  for(let y=0;y<H;y+=5)fill(c,0,y,W,1,'rgba(63,85,54,.019)');grade(c,assets);
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
