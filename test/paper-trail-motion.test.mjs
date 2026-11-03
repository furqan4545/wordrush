import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,normalizeSettings,createScene,getFrameState,projectPoint} from '../public/paper-trail/engine.js';

const MODES=['tilted','crawl','topdown'];
const SHAPES=['9:16','1:1','16:9'];
const STORIES=[
  ['My name is','A little idea','Your mind'],
  ['One','A longer sentence should wrap naturally while remaining the only highlighted sentence in view, even when its neighbors are short.','Done','We follow the arrow down the paper.'],
];
const dimensions=(aspect,edge=720)=>{const[a,b]=aspect.split(':').map(Number);return a>=b?{width:edge*a/b,height:edge}:{width:edge,height:edge*b/a};};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const bbox=points=>({left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))});
const intersects=(b,scene)=>b.right>0&&b.left<scene.width&&b.bottom>0&&b.top<scene.height;
const sceneFor=(lines,mode='tilted',aspect='9:16',extra={})=>createScene({lines,mode,aspect,pace:2.2,texture:.35,...extra},dimensions(aspect,extra.edge??720));
const phrasePoints=item=>[...item.circle,...[-1,1].flatMap(x=>[-1,1].map(y=>({x:item.x+x*(item.width/2+3),y:item.y+y*(item.height/2+3)})))];
const phraseBounds=(scene,item,time)=>bbox(phrasePoints(item).map(p=>projectPoint(scene,time,p)));
const holds=scene=>scene.layout.map((item,index)=>({index,time:index===0?scene.layout[1]?.start*.95||scene.duration-scene.settings.hold-.01:item.start+scene.settings.pace*.97}));
const cameraPoint=(scene,t)=>{const c=getFrameState(scene,t).camera;return{x:c.x,y:c.y};};
const minus=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const divide=(a,n)=>({x:a.x/n,y:a.y/n});
const second=(a,b,c,h)=>({x:(a.x-2*b.x+c.x)/(h*h),y:(a.y-2*b.y+c.y)/(h*h)});
const transitionDuration=scene=>scene.settings.pace*scene.settings.travel;

// These assert user-visible frame geometry independently of the engine's visible-index list.
test('one complete sentence occupies every resting view across cameras, shapes and output sizes',()=>{
  for(const lines of STORIES)for(const mode of MODES)for(const aspect of SHAPES)for(const edge of[720,1080]){
    const scene=sceneFor(lines,mode,aspect,{edge});
    for(const{index,time}of holds(scene)){
      const label=`${mode} ${aspect} ${edge}px, sentence ${index+1}`,active=phraseBounds(scene,scene.layout[index],time),mx=scene.width*.045,my=scene.height*.045;
      assert.ok(active.left>=mx&&active.right<=scene.width-mx&&active.top>=my&&active.bottom<=scene.height-my,`${label}: active text/circle must fit safely: ${JSON.stringify(active)}`);
      for(const item of scene.layout)if(item.index!==index)assert.ok(!intersects(phraseBounds(scene,item,time),scene),`${label}: another story sentence is in view`);
      const state=getFrameState(scene,time),center=projectPoint(scene,time,scene.layout[index]);
      assert.ok(distance(center,state.focalPoint)<Math.min(scene.width,scene.height)*.025,`${label}: arriving text must share the steady focus point`);
    }
    scene.dispose();
  }
});

test('the full journey and extreme motion controls never reveal two story sentences',()=>{
  const variants=[{}, {curve:1,curveDirection:'right',paperMotion:1,focusY:.3,spacing:1}, {curve:1,curveDirection:'alternate',paperMotion:1,focusY:.7,spacing:1}];
  for(const mode of MODES)for(const aspect of SHAPES)for(const extra of variants){
    const scene=sceneFor(STORIES[1],mode,aspect,extra);
    for(let step=0;step<=200;step++){
      const time=scene.duration*step/200,visible=scene.layout.filter(item=>intersects(phraseBounds(scene,item,time),scene));
      assert.ok(visible.length<=1,`${mode} ${aspect} at ${time.toFixed(4)}: sentences ${visible.map(i=>i.index+1).join(', ')} appear together`);
    }
    scene.dispose();
  }
});

test('long crawl stories keep distant sentences beyond the horizon',()=>{
  const lines=Array.from({length:20},(_,i)=>i===9?'A longer sentence stays completely readable while the paper continues below it.':`Story ${i+1}`);
  for(const aspect of SHAPES){const scene=sceneFor(lines,'crawl',aspect);for(const{index,time}of holds(scene))for(const item of scene.layout)if(item.index!==index)assert.ok(!intersects(phraseBounds(scene,item,time),scene),`${aspect}: stop ${index+1} exposes distant stop ${item.index+1}`);scene.dispose();}
});

test('the fiftieth sentence is the final complete resting view in every camera',()=>{
  const lines=Array.from({length:50},(_,i)=>`Story line ${i+1}`);
  for(const mode of MODES){
    const scene=sceneFor(lines,mode),last=scene.layout[49],time=scene.duration-scene.settings.hold-.01;
    assert.equal(last.text,lines[49]);
    const state=getFrameState(scene,time),bounds=phraseBounds(scene,last,time);
    assert.equal(state.activeIndex,49,'the renderer selects the fiftieth stop');
    assert.equal(state.phase,'hold');
    assert.ok(bounds.left>=0&&bounds.right<=scene.width&&bounds.top>=0&&bounds.bottom<=scene.height,'the complete final phrase fits');
    for(const item of scene.layout)if(item!==last)assert.ok(!intersects(phraseBounds(scene,item,time),scene),`${mode}: line 50 must not expose line ${item.index+1}`);
    assert.ok(distance(projectPoint(scene,time,last),state.focalPoint)<Math.min(scene.width,scene.height)*.025,'line 50 arrives at the same calm focus point');
    scene.dispose();
  }
});

test('the default arrow has a visible curve, with independent bend and direction controls',()=>{
  for(const mode of MODES)for(const aspect of SHAPES){
    const curved=sceneFor(STORIES[0],mode,aspect,{paperMotion:0});
    const straight=sceneFor(STORIES[0],mode,aspect,{curve:0,paperMotion:0});
    const left=curved.layout[1].connector,flat=straight.layout[1].connector;
    const deflection=Math.max(...left.map(p=>Math.abs(p.x-left[0].x)))*curved.cameraScale;
    assert.ok(deflection>=curved.width*.09,`${mode} ${aspect}: the default arrow should read as a curve, not a near-straight stem (${deflection}px)`);
    assert.ok(Math.max(...flat.map(p=>Math.abs(p.x-flat[0].x)))<1e-6,'zero bend must intentionally make a straight connector');
    curved.dispose();straight.dispose();
  }
  const left=sceneFor(STORIES[0],'topdown','9:16',{curveDirection:'left'}),right=sceneFor(STORIES[0],'topdown','9:16',{curveDirection:'right'}),alternate=sceneFor(STORIES[0],'topdown','9:16',{curveDirection:'alternate'});
  assert.ok(left.layout[1].connector.some(p=>p.x<-20),'left direction actually bows left');
  assert.ok(right.layout[1].connector.some(p=>p.x>20),'right direction actually bows right');
  assert.ok(Math.sign(alternate.layout[1].connector[50].x)!==Math.sign(alternate.layout[2].connector[50].x),'alternate direction changes the next connector');
  left.dispose();right.dispose();alternate.dispose();
});

test('the default sequence bends its first arrow right and its second arrow left',()=>{
  for(const mode of MODES){
    const scene=sceneFor(STORIES[0],mode);
    assert.equal(scene.settings.curveDirection,'alternate','the requested right-then-left sequence is the default');
    const first=scene.layout[1].connector,second=scene.layout[2].connector;
    assert.ok(first[50].x>first[0].x+20,`${mode}: the first arrow must visibly bow right`);
    assert.ok(second[50].x<second[0].x-20,`${mode}: the second arrow must visibly bow left`);
    scene.dispose();
  }
});

test('arrow travel distance changes the actual route without changing entered timing',()=>{
  const arcLength=points=>points.slice(1).reduce((sum,p,i)=>sum+distance(p,points[i]),0);
  for(const mode of MODES){
    const near=sceneFor(STORIES[0],mode,'9:16',{spacing:1,pace:2.6});
    const far=sceneFor(STORIES[0],mode,'9:16',{spacing:1.8,pace:2.6});
    for(let i=1;i<near.layout.length;i++){
      const a=near.layout[i].connector,b=far.layout[i].connector;
      assert.ok(distance(b[0],b.at(-1))>distance(a[0],a.at(-1))*1.5,`${mode}: distance must move the real arrow endpoints apart`);
      assert.ok(arcLength(b)>arcLength(a)*1.4,`${mode}: the curved route itself must become longer`);
    }
    assert.equal(far.settings.pace,2.6,'the selected time per line is preserved');
    assert.equal(far.duration,near.duration,'distance is independent of total video duration');
    near.dispose();far.dispose();
  }
});

test('the moving arrow remains close to the chosen reading focus through each curve',()=>{
  for(const mode of MODES)for(const aspect of SHAPES)for(const focusY of[.3,.5,.7]){
    const scene=sceneFor(STORIES[0],mode,aspect,{focusY});let count=0;
    for(let index=1;index<scene.layout.length;index++)for(let n=0;n<=120;n++){
      const time=scene.layout[index].start+transitionDuration(scene)*n/120,state=getFrameState(scene,time);
      if(state.phase!=='travel')continue;
      assert.ok(state.arrowTip,'travel needs a visible arrow tip');
      const tip=projectPoint(scene,time,state.arrowTip.world);
      assert.ok(distance(tip,state.focalPoint)<Math.min(scene.width,scene.height)*.10,`${mode} ${aspect}: arrow moves too far from the eye position`);
      assert.ok(distance(tip,state.arrowTip.screen)<.001,'arrow diagnostics agree with the actual projected point');count++;
    }
    assert.ok(count>20,'exercise enough of the visible trip');
    const hold=getFrameState(scene,scene.layout[1].start*.95);
    assert.ok(Math.abs(hold.focalPoint.y-scene.height*focusY)<scene.height*.025,'focus position control moves the actual reading point');
    scene.dispose();
  }
});

test('camera velocity and acceleration stay continuous through every former sampled-path knot',()=>{
  const scene=sceneFor(STORIES[0],'topdown','9:16',{paperMotion:0,pace:3});
  const start=scene.layout[1].start,D=transitionDuration(scene),L=scene.layout[1].y-scene.layout[0].y,h=D*1e-5;
  const averageSpeed=L/D,accelerationScale=L/(D*D);
  for(let k=1;k<100;k++){
    // Locate the actual analytic path parameter; a linear camera following 101 points
    // introduces derivative breaks here even if all its named phase joins are smooth.
    let lo=start,hi=start+D;for(let n=0;n<32;n++){const mid=(lo+hi)/2;if(getFrameState(scene,mid).journeyProgress<k/100)lo=mid;else hi=mid;}
    const t=(lo+hi)/2,p0=cameraPoint(scene,t),pm=cameraPoint(scene,t-h),pp=cameraPoint(scene,t+h);
    const vl=divide(minus(p0,pm),h),vr=divide(minus(pp,p0),h);
    assert.ok(distance(vl,vr)/averageSpeed<.00035,`camera velocity jumps at path knot ${k}`);
    const al=second(p0,pm,cameraPoint(scene,t-2*h),h),ar=second(cameraPoint(scene,t+2*h),pp,p0,h);
    assert.ok(distance(al,ar)/accelerationScale<.06,`camera acceleration jumps at path knot ${k}`);
  }
  scene.dispose();
});

test('one ease envelope starts and stops softly without tiny pauses inside the trip',()=>{
  for(const mode of MODES)for(const pace of[.6,1.8,4,6]){
    const scene=sceneFor(STORIES[0],mode,'9:16',{paperMotion:0,pace}),D=transitionDuration(scene),start=scene.layout[1].start,L=scene.layout[1].y-scene.layout[0].y,h=D*1e-5,averageSpeed=L/D;
    for(let n=0;n<=200;n++){
      const q=.08+.84*n/200,t=start+D*q,a=cameraPoint(scene,t-h),b=cameraPoint(scene,t+h),speed=(b.y-a.y)/(2*h);
      assert.ok(speed/averageSpeed>.025,`${mode} pace ${pace}: the camera pauses inside the journey at ${(q*100).toFixed(2)}%`);
    }
    for(const q of[.001,.999]){const t=start+D*q,speed=distance(cameraPoint(scene,t-h),cameraPoint(scene,t+h))/(2*h);assert.ok(speed/averageSpeed<.002,`${mode}: the trip should ease gently ${q<.5?'away from':'into'} its resting frame`);}
    scene.dispose();
  }
});

test('jerk remains continuous where the speed ramps meet cruising and rest',()=>{
  const scene=sceneFor(STORIES[0],'topdown','9:16',{paperMotion:0,pace:3});
  const start=scene.layout[1].start,D=transitionDuration(scene),L=scene.layout[1].y-scene.layout[0].y;
  const timing=getFrameState(scene,start+D*.5).timing,h=D*.0003,scale=L/(D**3);
  const jerk=(a,b,c,d)=>({x:(a.x-3*b.x+3*c.x-d.x)/(h**3),y:(a.y-3*b.y+3*c.y-d.y)/(h**3)});
  for(const q of[0,timing.easeIn,1-timing.easeOut,1]){
    const t=start+D*q,p=cameraPoint(scene,t);
    const left=jerk(p,cameraPoint(scene,t-h),cameraPoint(scene,t-2*h),cameraPoint(scene,t-3*h));
    const right=jerk(cameraPoint(scene,t+3*h),cameraPoint(scene,t+2*h),cameraPoint(scene,t+h),p);
    assert.ok(distance(left,right)/scale<.5,`a visible jerk occurs at ${Math.round(q*100)}% of the trip`);
  }
  scene.dispose();
});

test('ease, duration and camera smoothing controls change the actual journey',()=>{
  const base=sceneFor(STORIES[0],'topdown','9:16',{paperMotion:0,easeIn:.2,easeOut:.2});
  const slowStart=sceneFor(STORIES[0],'topdown','9:16',{paperMotion:0,easeIn:.7,easeOut:.2});
  const slowStop=sceneFor(STORIES[0],'topdown','9:16',{paperMotion:0,easeIn:.2,easeOut:.7});
  const moreSmooth=sceneFor(STORIES[0],'topdown','9:16',{paperMotion:0,cameraSmooth:1,easeIn:.2,easeOut:.2});
  const fast=sceneFor(STORIES[0],'topdown','9:16',{paperMotion:0,travel:.45});
  const start=base.layout[1].start,D=transitionDuration(base),p=(s,q)=>getFrameState(s,s.layout[1].start+D*q).journeyProgress;
  assert.ok(p(slowStart,.2)<p(base,.2)-.015,'start easing changes the early speed, not just a displayed value');
  assert.ok(p(slowStop,.8)>p(base,.8)+.015,'stop easing starts slowing before the destination');
  assert.ok(Math.abs(p(moreSmooth,.1)-p(base,.1))>.0001,'camera smoothing changes interpolation inside the acceleration ramp');
  assert.equal(getFrameState(fast,fast.layout[1].start+fast.settings.pace*.5).phase,'hold','shorter travel reaches its sentence earlier');
  assert.equal(fast.settings.pace,base.settings.pace,'travel preserves the selected line time');
  assert.ok(fast.duration>base.duration,'opening duration follows the equal reading pause while skipping the nonexistent first trip');
  for(const s of[base,slowStart,slowStop,moreSmooth,fast])s.dispose();
});

test('paper movement is visible and deterministic, can be stopped, and has a real speed control',()=>{
  for(const mode of MODES){
    const scene=sceneFor(['Stay with this thought.'],mode,'9:16',{pace:5,hold:5}),still=sceneFor(['Stay with this thought.'],mode,'9:16',{pace:5,hold:5,paperMotion:0}),slow=sceneFor(['Stay with this thought.'],mode,'9:16',{pace:5,hold:5,paperSpeed:.2}),fast=sceneFor(['Stay with this thought.'],mode,'9:16',{pace:5,hold:5,paperSpeed:1.5});
    const marker={x:250,y:-210},samples=[];let speedDifference=0;
    for(let t=.8;t<8;t+=.2){
      const state=getFrameState(scene,t);assert.deepEqual(state,getFrameState(scene,t),'preview and export must share deterministic motion');
      assert.ok(distance(projectPoint(still,t,marker),projectPoint(still,.8,marker))<1e-8,'zero paper motion makes the entire plane still');
      samples.push(projectPoint(scene,t,marker));speedDifference+=distance(projectPoint(slow,t,marker),projectPoint(fast,t,marker));
    }
    const r=bbox(samples),extent=Math.hypot(r.right-r.left,r.bottom-r.top);
    assert.ok(extent>Math.min(scene.width,scene.height)*.006,`${mode}: default paper sway should be perceptible (${extent}px)`);
    assert.ok(extent<Math.min(scene.width,scene.height)*.06,`${mode}: sway should remain gentle`);
    assert.ok(speedDifference>10,'paper speed changes the actual oscillation');
    for(const s of[scene,still,slow,fast])s.dispose();
  }
});

test('paper texture has continuous unwrapped world motion, including across tile boundaries',()=>{
  const scene=sceneFor(STORIES[0],'tilted','9:16',{paperMotion:0}),start=scene.layout[1].start,D=transitionDuration(scene),phases=[];
  for(let n=0;n<=240;n++){const state=getFrameState(scene,start+D*n/240);assert.ok(state.texturePhase,'world-anchored texture diagnostics are required');phases.push(state.texturePhase);}
  for(let n=1;n<phases.length;n++)assert.ok(distance(phases[n],phases[n-1])<scene.spacing*.03,'paper grain must not jump at a modulo/tile boundary');
  assert.ok(Math.abs(phases.at(-1).y-phases[0].y)>scene.spacing*.95,'grain follows the full sheet movement rather than cycling in screen space');
  scene.dispose();
});

test('edge blur responds to movement and its amount and width settings, with an explicit off state',()=>{
  const moving=sceneFor(STORIES[0],'topdown','9:16',{edgeBlur:.6,blurWidth:.36}),off=sceneFor(STORIES[0],'topdown','9:16',{edgeBlur:0,blurWidth:.1});
  const t=moving.layout[1].start+transitionDuration(moving)*.5,a=getFrameState(moving,t),b=getFrameState(off,t);
  assert.ok(a.blur.amount>0,'moving paper has a nonzero edge blur');
  assert.equal(b.blur.amount,0,'zero blur bypasses the effect completely');
  assert.equal(a.blur.width,.36,'blur width is part of the actual render state');
  assert.equal(b.blur.width,.1,'narrow blur width is preserved independently');
  assert.ok(getFrameState(moving,moving.layout[1].start*.95).blur.amount<a.blur.amount*.15,'blur clears when the camera rests');
  moving.dispose();off.dispose();
});

test('mixed sentence lengths keep a stable resting scale instead of per-stop zoom changes',()=>{
  for(const mode of MODES){const scene=sceneFor(STORIES[1],mode,'9:16');const scales=holds(scene).map(({time})=>getFrameState(scene,time).camera.scale);assert.ok(Math.max(...scales)/Math.min(...scales)<1.03,`${mode}: phrase length causes a zoom change`);scene.dispose();}
});
