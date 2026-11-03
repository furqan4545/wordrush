import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../public/paper-trail/engine.js';

const {DEFAULTS, normalizeSettings, createScene, renderFrame, projectPoint, getFrameState} = engine;
const KEYS = ['arrowWidth','circleWidth','arrowStyle','circleStyle','dotSpacing'];
const close = (actual, expected, tolerance=1e-6) => assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} should equal ${expected}`);
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const sceneFor = (raw={},edge=1080) => createScene({lines:['One thought','The next thought'],mode:'topdown',paperMotion:0,texture:0,edgeBlur:0,pace:2,hold:1,...raw},{width:edge,height:edge*16/9});

// A minimal Canvas2D recorder exercises the real drawing path without requiring a
// different rasterizer from the browser used by the application.
function canvasRecorder(scene) {
  const strokes=[],arcs=[],fills=[],stack=[];
  const ctx={canvas:{width:scene.width,height:scene.height},strokes,arcs,fills,
    globalAlpha:1,lineWidth:1,strokeStyle:'#000',fillStyle:'#000',transform:[1,0,0,1,0,0],path:[],
    save(){stack.push({globalAlpha:this.globalAlpha,lineWidth:this.lineWidth,strokeStyle:this.strokeStyle,fillStyle:this.fillStyle,transform:[...this.transform]});},
    restore(){Object.assign(this,stack.pop());},
    setTransform(...value){this.transform=value;},
    beginPath(){this.path=[];},
    moveTo(x,y){this.path.push({type:'move',x,y});},
    lineTo(x,y){this.path.push({type:'line',x,y});},
    arc(x,y,r,start,end){const [a,b,c,d,e,f]=this.transform;const item={x:a*x+c*y+e,y:b*x+d*y+f,r,alpha:this.globalAlpha,start,end};this.path.push({type:'arc',...item});arcs.push(item);},
    stroke(){strokes.push({width:this.lineWidth,color:this.strokeStyle,alpha:this.globalAlpha,path:structuredClone(this.path)});},
    fill(){fills.push({color:this.fillStyle,alpha:this.globalAlpha,path:structuredClone(this.path)});},
    setLineDash(value){this.dash=[...value];},
    getLineDash(){return this.dash||[];},
    fillRect(){},clearRect(){},fillText(){},drawImage(){},
    createLinearGradient(){return {addColorStop(){}};},
    createRadialGradient(){return {addColorStop(){}};},
  };
  return ctx;
}

test('arrow and circle weights and dotted styles are independent and survive saving',()=>{
  const values={arrowWidth:19,circleWidth:3,arrowStyle:'dotted',circleStyle:'solid',dotSpacing:31};
  const normalized=normalizeSettings(values),restored=normalizeSettings(JSON.parse(JSON.stringify(normalized)));
  for(const key of KEYS){assert.equal(normalized[key],values[key],`${key} preserves the entered value`);assert.equal(restored[key],values[key],`${key} survives reload`);}
  const opposite=normalizeSettings({arrowWidth:3,circleWidth:19,arrowStyle:'solid',circleStyle:'dotted'});
  assert.equal(opposite.arrowWidth,3);assert.equal(opposite.circleWidth,19);
  assert.equal(opposite.arrowStyle,'solid');assert.equal(opposite.circleStyle,'dotted');
  assert.ok(DEFAULTS.arrowWidth>=8,'the new arrow default must be visibly heavier than the former shared thin ink');
  assert.ok(DEFAULTS.circleWidth>=7,'the new circle default must also be heavier');
});

test('stroke controls reject invalid values while keeping usable defaults',()=>{
  const normalized=normalizeSettings({arrowWidth:-100,circleWidth:999,arrowStyle:'url(foo)',circleStyle:null,dotSpacing:0});
  assert.equal(normalized.arrowWidth,1);assert.equal(normalized.circleWidth,24);
  assert.equal(normalized.arrowStyle,'solid');assert.equal(normalized.circleStyle,'solid');assert.equal(normalized.dotSpacing,4);
  const fallback=normalizeSettings({arrowWidth:NaN,circleWidth:Infinity,dotSpacing:'nope'});
  for(const key of ['arrowWidth','circleWidth','dotSpacing'])assert.equal(fallback[key],DEFAULTS[key]);
});

test('weight diagnostics scale by output resolution rather than by phrase zoom',()=>{
  assert.equal(typeof engine.getStrokeStyle,'function');
  for(const kind of ['arrow','circle']){
    const small=sceneFor({arrowWidth:12,circleWidth:5},720),large=sceneFor({arrowWidth:12,circleWidth:5},1080);
    const a=engine.getStrokeStyle(small,kind),b=engine.getStrokeStyle(large,kind);
    close(b.widthPx/a.widthPx,1.5);close(b.gapPx/a.gapPx,1.5);
    close(b.widthPx,kind==='arrow'?12:5);
    const long=sceneFor({lines:['A substantially longer phrase changes framing without changing the chosen visible ink thickness'],arrowWidth:12,circleWidth:5},1080);
    close(engine.getStrokeStyle(long,kind).widthPx,b.widthPx);
    small.dispose();large.dispose();long.dispose();
  }
});

test('the actual solid renderer applies separate widths and scales them at 720p and1080p',()=>{
  for(const edge of [720,1080]){
    const scene=sceneFor({arrowWidth:12,circleWidth:4,arrowStyle:'solid',circleStyle:'solid'},edge),ctx=canvasRecorder(scene);
    renderFrame(ctx,scene,3.95);
    const markStrokes=ctx.strokes.filter(s=>s.color===scene.settings.accent);
    assert.ok(markStrokes.some(s=>Math.abs(s.width-12*edge/1080)<1e-6),'the drawn arrow must use its own thickness');
    assert.ok(markStrokes.some(s=>Math.abs(s.width-4*edge/1080)<1e-6),'the drawn circles must use their own thickness');
    scene.dispose();
  }
});

test('dotted arrows render round marks but retain a solid directional arrowhead',()=>{
  const scene=sceneFor({arrowStyle:'dotted',circleStyle:'solid'}),ctx=canvasRecorder(scene);
  renderFrame(ctx,scene,3.1);
  assert.ok(ctx.arcs.length>5,'the shaft should consist of actual round dots');
  const head=ctx.strokes.find(s=>s.color===scene.settings.accent&&s.path.length===3&&s.path.every(p=>p.type==='move'||p.type==='line'));
  assert.ok(head,'a dotted shaft still needs one readable solid open-V head');
  assert.ok(ctx.strokes.some(s=>s.path.length>40),'the independently solid circle must remain an outlined path');
  assert.ok(ctx.fills.some(f=>f.path.some(p=>p.type==='arc')),'dot circles must be filled, not tiny hollow rings');
  scene.dispose();
});

test('circle dots and arrow dots can be selected independently without paint-state leakage',()=>{
  const circleScene=sceneFor({arrowStyle:'solid',circleStyle:'dotted'}),a=canvasRecorder(circleScene);
  renderFrame(a,circleScene,3.95);
  assert.ok(a.arcs.length>5,'circle dotted mode produces round dots');
  assert.ok(a.strokes.some(s=>s.path.length>40),'solid arrow shaft remains a continuous path');
  const solidScene=sceneFor({arrowStyle:'solid',circleStyle:'solid'}),b=canvasRecorder(solidScene);
  renderFrame(b,solidScene,3.95);
  assert.equal(b.arcs.length,0,'switching to solid leaves no dots behind');
  assert.ok(b.strokes.some(s=>s.path.length>40));
  circleScene.dispose();solidScene.dispose();
});

test('dots are anchored at uniform paper distances with density controlled by the selected gap',()=>{
  assert.equal(typeof engine.getPathDots,'function');
  const scene=sceneFor({arrowStyle:'dotted',circleStyle:'dotted',arrowWidth:8,circleWidth:7,dotSpacing:14});
  for(const kind of ['arrow','circle']){
    const points=kind==='arrow'?scene.layout[1].connector:scene.layout[1].circle;
    const dots=engine.getPathDots(scene,points,kind),again=engine.getPathDots(scene,points,kind);
    assert.deepEqual(dots,again,'same paper path has stable positions on each evaluation');
    assert.ok(dots.length>5);
    const pitch=(engine.getStrokeStyle(scene,kind).widthPx+engine.getStrokeStyle(scene,kind).gapPx)/scene.cameraScale;
    for(let i=1;i<dots.length;i++)close(dots[i].distance-dots[i-1].distance,pitch,1e-5);
    assert.ok(dots.every((d,i)=>Number.isFinite(d.x)&&Number.isFinite(d.y)&&d.progress>=0&&d.progress<=1&&(!i||d.progress>dots[i-1].progress)));
  }
  const dense=sceneFor({arrowStyle:'dotted',dotSpacing:4}),sparse=sceneFor({arrowStyle:'dotted',dotSpacing:40});
  assert.ok(engine.getPathDots(dense,dense.layout[1].connector,'arrow').length>engine.getPathDots(sparse,sparse.layout[1].connector,'arrow').length*2,'gap must visibly change actual dot density');
  scene.dispose();dense.dispose();sparse.dispose();
});

test('the revealed dots use the same fixed paper positions while the camera moves',()=>{
  const scene=sceneFor({arrowStyle:'dotted',circleStyle:'solid'}),dots=engine.getPathDots(scene,scene.layout[1].connector,'arrow');
  const frames=[2.55,2.8,3.05].map(time=>{const ctx=canvasRecorder(scene);renderFrame(ctx,scene,time);return {time,ctx,state:getFrameState(scene,time)};});
  for(const {time,ctx,state} of frames){
    assert.ok(ctx.arcs.length>3,'exercise actual revealed dots, not only the held arrow');
    const expected=dots.map(d=>({dot:d,screen:projectPoint(scene,time,d)}));
    for(const actual of ctx.arcs){
      const match=expected.find(p=>distance(actual,p.screen)<1e-5);
      assert.ok(match,'drawn dot centers must remain tied to the existing paper path, not to the viewport');
      assert.ok(match.dot.progress<=state.arrowProgress+.02,'dots should not appear substantially ahead of the arrow tip');
    }
  }
  scene.dispose();
});
