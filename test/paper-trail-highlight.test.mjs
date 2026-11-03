import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../public/paper-trail/engine.js';

const {DEFAULTS,normalizeSettings,createScene,renderFrame,projectPoint}=engine;
const SHAPES=['circle','underline','box'];
const MODES=['tilted','crawl','topdown'];
const ASPECTS=['9:16','1:1','16:9'];
const sceneFor=(settings={},width=1080)=>createScene({lines:['A thought worth keeping.'],mode:'topdown',paperMotion:0,texture:0,edgeBlur:0,pace:2,accent:'#13579b',...settings},{width,height:width*16/9});
const bbox=points=>({left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))});
const near=(a,b,tolerance=1e-6)=>Math.abs(a-b)<=tolerance;
const intersects=(a,scene)=>a.right>0&&a.left<scene.width&&a.bottom>0&&a.top<scene.height;
function pathsFor(scene,item=scene.layout[0]){
  assert.equal(typeof engine.getHighlightPaths,'function','shape geometry needs a pure inspection API');
  const paths=engine.getHighlightPaths(scene,item);
  assert.ok(Array.isArray(paths)&&paths.length>0,'each selected shape must supply drawable geometry');
  assert.ok(paths.every(p=>Array.isArray(p)&&p.length>=2&&p.every(v=>Number.isFinite(v.x)&&Number.isFinite(v.y))),'all shape points must be finite paper coordinates');
  return paths;
}
function baseline(scene,item,row){return item.y-item.height/2+scene.settings.textSize*.86+row*(item.lineHeight??scene.settings.textSize*1.25);}

// Record actual Canvas2D painting order, geometry and clipping. Browser pixel QA
// remains with the parent; this catches errors hidden by correct settings alone.
function recorder(scene){
  const events=[],stack=[];
  const point=(ctx,x,y)=>{const[a,b,c,d,e,f]=ctx.transform;return{x:a*x+c*y+e,y:b*x+d*y+f};};
  const bounds=(ctx,points)=>{const b=bbox(points);if(!ctx.clipBounds)return b;return{left:Math.max(b.left,ctx.clipBounds.left),right:Math.min(b.right,ctx.clipBounds.right),top:Math.max(b.top,ctx.clipBounds.top),bottom:Math.min(b.bottom,ctx.clipBounds.bottom)};};
  const ctx={canvas:{width:scene.width,height:scene.height},events,path:[],transform:[1,0,0,1,0,0],globalAlpha:1,lineWidth:1,strokeStyle:'#000',fillStyle:'#000',clipBounds:null,
    save(){stack.push({transform:[...this.transform],globalAlpha:this.globalAlpha,lineWidth:this.lineWidth,strokeStyle:this.strokeStyle,fillStyle:this.fillStyle,clipBounds:this.clipBounds&&{...this.clipBounds}});},
    restore(){Object.assign(this,stack.pop());},setTransform(...v){this.transform=v;},
    beginPath(){this.path=[];},moveTo(x,y){this.path.push({type:'move',...point(this,x,y)});},lineTo(x,y){this.path.push({type:'line',...point(this,x,y)});},
    rect(x,y,w,h){for(const p of [[x,y],[x+w,y],[x+w,y+h],[x,y+h]])this.path.push({type:'line',...point(this,...p)});},
    closePath(){this.path.push({...this.path[0],type:'close'});},
    arc(x,y,r,start,end){const p=point(this,x,y);this.path.push({type:'arc',...p,r,start,end});},
    quadraticCurveTo(cx,cy,x,y){this.path.push({type:'quadratic',...point(this,x,y),control:point(this,cx,cy)});},
    bezierCurveTo(a,b,c,d,x,y){this.path.push({type:'bezier',...point(this,x,y),controls:[point(this,a,b),point(this,c,d)]});},
    stroke(){events.push({type:'stroke',color:this.strokeStyle,alpha:this.globalAlpha,width:this.lineWidth,path:structuredClone(this.path)});},
    fill(){events.push({type:'fill',color:this.fillStyle,alpha:this.globalAlpha,path:structuredClone(this.path),bounds:bounds(this,this.path)});},
    fillRect(x,y,w,h){const points=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(p=>point(this,...p));events.push({type:'fill',color:this.fillStyle,alpha:this.globalAlpha,path:points,bounds:bounds(this,points)});},
    clip(){this.clipBounds=bounds(this,this.path);},
    fillText(text,x,y){events.push({type:'text',text,color:this.fillStyle,alpha:this.globalAlpha,point:point(this,x,y)});},
    setLineDash(v){this.dash=[...v];},getLineDash(){return this.dash||[];},clearRect(){},drawImage(){},
    createLinearGradient(){return{addColorStop(){}};},createRadialGradient(){return{addColorStop(){}};},
  };
  return ctx;
}
function painted(scene,time=scene.settings.pace*.94){const ctx=recorder(scene);renderFrame(ctx,scene,time);return ctx.events;}

test('highlight controls preserve the selected shape, edge style, fill and underline passes',()=>{
  const values={highlightShape:'box',underlinePasses:1,boxEdges:'full',boxFill:false,highlightFill:'#AcB',fillOpacity:0};
  const normalized=normalizeSettings(values),restored=normalizeSettings(JSON.parse(JSON.stringify(normalized)));
  for(const[key,value]of Object.entries(values)){assert.equal(normalized[key],value,`${key} preserves its entered value`);assert.equal(restored[key],value,`${key} survives saving and reload`);}
  assert.equal(normalizeSettings({highlightShape:'underline',underlinePasses:2}).highlightShape,'underline');
  assert.equal(DEFAULTS.highlightShape,'circle','existing projects retain the original circle by default');
  assert.equal(DEFAULTS.underlinePasses,2);assert.equal(DEFAULTS.boxEdges,'brackets');assert.equal(DEFAULTS.boxFill,true);
  const bad=normalizeSettings({highlightShape:'url(example)',underlinePasses:9,boxEdges:'round',highlightFill:'red;url(example)',fillOpacity:99});
  assert.equal(bad.highlightShape,DEFAULTS.highlightShape);assert.equal(bad.underlinePasses,DEFAULTS.underlinePasses);assert.equal(bad.boxEdges,DEFAULTS.boxEdges);assert.equal(bad.highlightFill,DEFAULTS.highlightFill);assert.equal(bad.fillOpacity,1);
});

test('underline passes sit below their text, span the words, and support wrapped sentences',()=>{
  for(const phrase of ['An idea', 'A long sentence has enough words to wrap into several rows while each row gets its own neat animated underline.']){
    const scene=sceneFor({lines:[phrase],highlightShape:'underline',textSize:72}),item=scene.layout[0],paths=pathsFor(scene);
    assert.equal(paths.length,item.rows.length*2,'the reference double underline is present under each wrapped row');
    for(let row=0;row<item.rows.length;row++){
      const rowPaths=paths.filter(path=>Math.min(...path.map(p=>p.y))>baseline(scene,item,row)+scene.settings.textSize*.12&&Math.max(...path.map(p=>p.y))<baseline(scene,item,row)+scene.settings.textSize*.5);
      assert.equal(rowPaths.length,2,`row ${row+1} needs two strokes below its glyph baseline`);
      assert.ok(rowPaths.some(path=>{const b=bbox(path);return b.right-b.left>=item.widths[row]*.85;}),'the main pass covers the selected words');
      const widths=rowPaths.map(path=>{const b=bbox(path);return b.right-b.left;});assert.ok(Math.min(...widths)<Math.max(...widths)*.95,'the second hand-drawn pass is shorter rather than a duplicate line');
      assert.ok(rowPaths.every(path=>{const b=bbox(path);return b.bottom-b.top<scene.settings.textSize*.16;}),'hand-drawn wobble stays restrained');
    }
    const single=sceneFor({lines:[phrase],highlightShape:'underline',underlinePasses:1,textSize:72});
    assert.equal(pathsFor(single).length,single.layout[0].rows.length,'single-pass selection actually removes the second pass');
    scene.dispose();single.dispose();
  }
});

test('the underline draws a first pen pass before its shorter return stroke',()=>{
  const scene=sceneFor({highlightShape:'underline',underlinePasses:2,circleStyle:'solid'});
  const marks=time=>painted(scene,time).filter(event=>event.type==='stroke'&&event.color===scene.settings.accent);
  const early=marks(scene.settings.pace*.12),late=marks(scene.settings.pace*.94);
  assert.equal(early.length,1,'the second stroke should not start simultaneously with the first');
  assert.equal(late.length,2,'the second hand-drawn stroke appears by the settled view');
  const a=bbox(early[0].path),b=bbox(late[0].path);
  assert.ok(a.right-a.left<b.right-b.left,'the first line genuinely draws on instead of appearing fully formed');
  scene.dispose();
});

test('maximum-weight double underlines leave room for the next wrapped row in every video shape',()=>{
  const phrase='A long highlighted sentence should remain readable even with thick double underlines, so each row needs enough space below its words before the next row begins, without dropping or shortening any part of this thought.';
  assert.ok(phrase.length<=220,'the regression must fit the editor text limit');
  for(const aspect of ASPECTS){
    const [a,b]=aspect.split(':').map(Number),scene=createScene({lines:[phrase],highlightShape:'underline',underlinePasses:2,circleWidth:24,circleStyle:'solid',textSize:54,mode:'topdown',aspect,pace:2,paperMotion:0,texture:0,edgeBlur:0,accent:'#13579b'},{width:a>=b?720*a/b:720,height:a>=b?720:720*b/a});
    const item=scene.layout[0],time=scene.settings.pace*.94,events=painted(scene,time),strokes=events.filter(event=>event.type==='stroke'&&event.color===scene.settings.accent);
    assert.ok(item.rows.length>1,`${aspect}: exercise wrapped text, not a short single row`);
    assert.equal(item.text,phrase,'the original sentence remains unchanged');
    assert.equal(item.rows.join('').replace(/\s/g,''),phrase.replace(/\s/g,''),'reflow retains every letter');
    assert.equal(strokes.length,item.rows.length*2,'both actual painted passes are present for every row');
    for(let row=0;row<item.rows.length-1;row++){
      const lowerEdge=Math.max(...strokes.slice(row*2,row*2+2).map(stroke=>Math.max(...stroke.path.map(p=>p.y))+stroke.width/2));
      const nextGlyphTop=projectPoint(scene,time,{x:item.x,y:baseline(scene,item,row+1)-scene.settings.textSize*.86}).y;
      assert.ok(lowerEdge<nextGlyphTop,`${aspect}, row ${row+1}: a thick underline reaches the next row's letters (${lowerEdge} >= ${nextGlyphTop})`);
    }
    scene.dispose();
  }
});

test('box brackets have square corners and frame both sides without closing across the words',()=>{
  const scene=sceneFor({highlightShape:'box',boxEdges:'brackets'}),item=scene.layout[0],paths=pathsFor(scene);
  assert.equal(paths.length,2,'bracket edges are two separate square marks');
  const a=bbox(paths[0]),b=bbox(paths[1]);
  assert.ok(a.right<b.left,'bracket interiors remain open across the selected words');
  assert.ok(a.left<item.x-item.width/2&&b.right>item.x+item.width/2,'the selected phrase fits between the bracket stems');
  for(const path of paths){
    const bounds=bbox(path);assert.ok(bounds.top<item.y-item.height/2&&bounds.bottom>item.y+item.height/2,'each bracket surrounds the full text height');
    let horizontal=0,vertical=0;
    for(let i=1;i<path.length;i++){const dx=path[i].x-path[i-1].x,dy=path[i].y-path[i-1].y;if(Math.hypot(dx,dy)<1e-8)continue;assert.ok(near(dx,0)||near(dy,0),'square edges must not become an oval or diagonal corner');if(near(dx,0))vertical++;else horizontal++;}
    assert.ok(horizontal>=2&&vertical>=1,'each bracket has a vertical stem and two horizontal arms');
  }
  scene.dispose();
});

test('both complete box brackets start in the middle and move outward together',()=>{
  const scene=sceneFor({highlightShape:'box',boxEdges:'brackets',boxFill:false,circleStyle:'solid'}),item=scene.layout[0];
  const frame=u=>{
    const time=scene.settings.pace*.05+scene.settings.pace*Math.min(.19,.98-scene.settings.travel)*u;
    const strokes=painted(scene,time).filter(event=>event.type==='stroke'&&event.color===scene.settings.accent&&event.alpha>0);
    assert.equal(strokes.length,2,'both brackets must be painted at the same moment, not traced one after the other');
    return strokes.map(stroke=>bbox(stroke.path)).sort((a,b)=>a.left-b.left);
  };
  const fractions=[.18,.35,.5,.7,1],frames=fractions.map(frame),final=frames.at(-1);
  const target=pathsFor(scene).map(path=>bbox(path.map(p=>projectPoint(scene,scene.settings.pace*.94,p)))).sort((a,b)=>a.left-b.left);
  const center=projectPoint(scene,scene.settings.pace*.94,item).x;
  const finalWidth=final[1].right-final[0].left;
  assert.ok(frames[0][1].right-frames[0][0].left<finalWidth*.30,'the early brackets must occupy a narrow area around the sentence middle');
  for(let i=0;i<frames.length;i++){
    const [left,right]=frames[i],middle=(left.left+right.right)/2;
    assert.ok(near(middle,center),'the pair must keep the same midpoint while expanding in opposite directions');
    for(const [mark,finished] of [[left,final[0]],[right,final[1]]]){
      assert.ok(near(mark.top,finished.top)&&near(mark.bottom,finished.bottom),'brackets keep their full vertical span while moving; they do not draw down a stem');
      assert.ok(near(mark.right-mark.left,finished.right-finished.left),'bracket arms retain their shape instead of stretching');
    }
    if(i){assert.ok(left.left<frames[i-1][0].left,'the left bracket must move left');assert.ok(right.right>frames[i-1][1].right,'the right bracket must move right');}
  }
  for(let i=0;i<2;i++)for(const edge of ['left','right','top','bottom'])assert.ok(near(final[i][edge],target[i][edge]),'the final brackets must land exactly at the existing sentence edges');
  scene.dispose();
});

test('a full box expands symmetrically from the middle rather than tracing around its perimeter',()=>{
  const scene=sceneFor({highlightShape:'box',boxEdges:'full',boxFill:false,circleStyle:'solid'});
  const frame=u=>{
    const time=scene.settings.pace*.05+scene.settings.pace*Math.min(.19,.98-scene.settings.travel)*u;
    const strokes=painted(scene,time).filter(event=>event.type==='stroke'&&event.color===scene.settings.accent&&event.alpha>0);
    assert.equal(strokes.length,1);const stroke=strokes[0],b=bbox(stroke.path);
    assert.ok(near(stroke.path[0].x,stroke.path.at(-1).x)&&near(stroke.path[0].y,stroke.path.at(-1).y),'the expanding outline must already be closed');
    return b;
  };
  const frames=[.2,.4,.6,.8,1].map(frame),last=frames.at(-1),center=(last.left+last.right)/2;
  assert.ok(frames[0].right-frames[0].left<(last.right-last.left)*.3,'the outline starts near the sentence center');
  for(let i=0;i<frames.length;i++){
    const b=frames[i];assert.ok(near((b.left+b.right)/2,center),'full-box expansion stays centered');
    assert.ok(near(b.top,last.top)&&near(b.bottom,last.bottom),'full-box height remains stable');
    if(i)assert.ok(b.left<frames[i-1].left&&b.right>frames[i-1].right,'both sides must open outward simultaneously');
  }
  scene.dispose();
});

test('dotted brackets move their existing dots together without rephasing or progressively adding dots',()=>{
  const scene=sceneFor({highlightShape:'box',boxEdges:'brackets',boxFill:false,circleStyle:'dotted',circleWidth:9,dotSpacing:10});
  const paths=pathsFor(scene),leftCount=engine.getPathDots(scene,paths[0],'circle').length,rightCount=engine.getPathDots(scene,paths[1],'circle').length;
  const frame=u=>{
    const time=scene.settings.pace*.05+scene.settings.pace*Math.min(.19,.98-scene.settings.travel)*u;
    const dots=painted(scene,time).filter(event=>event.type==='fill'&&event.color===scene.settings.accent&&event.alpha>0&&event.path.some(p=>p.type==='arc')).map(event=>event.path.find(p=>p.type==='arc'));
    assert.equal(dots.length,leftCount+rightCount,'both complete dotted brackets are present throughout the expansion');
    return [dots.slice(0,leftCount),dots.slice(leftCount)];
  };
  const frames=[.25,.5,.75,1].map(frame);
  for(let f=1;f<frames.length;f++)for(let side=0;side<2;side++){
    const before=frames[f-1][side],after=frames[f][side],dx=after[0].x-before[0].x;
    assert.ok(side===0?dx<0:dx>0,'the two sets of dots must move in opposite directions');
    for(let i=0;i<after.length;i++){
      assert.ok(near(after[i].x-before[i].x,dx),'every dot in a bracket receives the same horizontal translation');
      assert.ok(near(after[i].y,before[i].y)&&near(after[i].r,before[i].r),'dot rows and diameters stay stable while the bracket moves');
    }
  }
  scene.dispose();
});

test('a full box is a closed square-edged outline around the complete wrapped text block',()=>{
  const scene=sceneFor({lines:['Several words make this highlighted sentence wrap across more than one row without losing the box.'],highlightShape:'box',boxEdges:'full',textSize:72}),item=scene.layout[0],paths=pathsFor(scene);
  assert.equal(paths.length,1);assert.ok(item.rows.length>1);
  const path=paths[0],b=bbox(path);assert.ok(b.left<item.x-item.width/2&&b.right>item.x+item.width/2&&b.top<item.y-item.height/2&&b.bottom>item.y+item.height/2);
  assert.ok(near(path[0].x,path.at(-1).x)&&near(path[0].y,path.at(-1).y),'full outline closes without an open side');
  for(let i=1;i<path.length;i++)assert.ok(near(path[i].x,path[i-1].x)||near(path[i].y,path[i-1].y),'all box edges are square');
  scene.dispose();
});

test('box marker fill expands from the middle behind the letters and can be disabled',()=>{
  const scene=sceneFor({highlightShape:'box',boxFill:true,fillOpacity:.62}),early=painted(scene,scene.settings.pace*.12),late=painted(scene);
  const fills=events=>events.filter(event=>event.type==='fill'&&event.color===scene.settings.highlightFill&&event.alpha>0);
  const partial=fills(early),full=fills(late);assert.ok(partial.length>0&&full.length>0,'yellow marker is actually painted, including during its reveal');
  const earlyBounds=bbox(partial.flatMap(e=>[{x:e.bounds.left,y:e.bounds.top},{x:e.bounds.right,y:e.bounds.bottom}])),fullBounds=bbox(full.flatMap(e=>[{x:e.bounds.left,y:e.bounds.top},{x:e.bounds.right,y:e.bounds.bottom}]));
  assert.ok(earlyBounds.right-earlyBounds.left<fullBounds.right-fullBounds.left,'the early marker stroke is narrower than the finished one');
  assert.ok(earlyBounds.left>fullBounds.left&&earlyBounds.right<fullBounds.right,'the marker must grow toward both sentence ends');
  assert.ok(Math.abs((earlyBounds.left+earlyBounds.right)-(fullBounds.left+fullBounds.right))<scene.width*.01,'the marker center stays anchored while both edges expand');
  const fillIndex=late.findIndex(event=>event.type==='fill'&&event.color===scene.settings.highlightFill),textIndex=late.findIndex(event=>event.type==='text'&&event.color===scene.settings.ink&&event.text===scene.layout[0].rows[0]);
  assert.ok(fillIndex>=0&&textIndex>fillIndex,'marker paint must be below the selected letters, not over them');
  assert.ok(full.every(event=>event.alpha<=scene.settings.fillOpacity+1e-6),'the marker honors selected opacity');
  const disabled=sceneFor({highlightShape:'box',boxFill:false}),without=painted(disabled);
  assert.ok(!without.some(event=>event.type==='fill'&&event.color===disabled.settings.highlightFill),'turning marker fill off really removes it');
  const transparent=sceneFor({highlightShape:'box',fillOpacity:0});assert.ok(!painted(transparent).some(event=>event.type==='fill'&&event.color===transparent.settings.highlightFill&&event.alpha>0),'zero opacity stays disabled');
  for(const shape of ['circle','underline']){const other=sceneFor({highlightShape:shape,boxFill:true});assert.ok(!painted(other).some(event=>event.type==='fill'&&event.color===other.settings.highlightFill),'box marker fill must not alter the other highlight types');other.dispose();}
  scene.dispose();disabled.dispose();transparent.dispose();
});

test('all three shapes support independent solid or dotted highlight strokes at the selected thickness',()=>{
  for(const shape of SHAPES){
    const solid=sceneFor({highlightShape:shape,circleStyle:'solid',circleWidth:13,arrowWidth:3,boxFill:false}),a=painted(solid);
    assert.ok(a.some(event=>event.type==='stroke'&&event.color===solid.settings.accent&&near(event.width,13)),`${shape}: drawn highlight uses its own selected stroke weight`);
    assert.ok(!a.some(event=>event.type==='fill'&&event.path.some(p=>p.type==='arc')),`${shape}: solid lines do not inherit dotted marks`);
    const dotted=sceneFor({highlightShape:shape,circleStyle:'dotted',circleWidth:13,arrowStyle:'solid',boxFill:false}),b=painted(dotted);
    assert.ok(b.filter(event=>event.type==='fill'&&event.color===dotted.settings.accent&&event.path.some(p=>p.type==='arc')).length>=4,`${shape}: dotted selection produces actual round dots`);
    solid.dispose();dotted.dispose();
  }
});

test('selected shapes fit the view and preserve one-sentence framing throughout each camera journey',()=>{
  const lines=['One thought', 'A longer sentence wraps into several lines while the chosen highlight still surrounds the complete thought.', 'The next thought'];
  for(const shape of SHAPES)for(const mode of MODES)for(const aspect of ASPECTS){
    const [a,b]=aspect.split(':').map(Number),scene=createScene({lines,highlightShape:shape,mode,aspect,pace:2.4,paperMotion:.35,boxEdges:'full'},{width:a>=b?720*a/b:720,height:a>=b?720:720*b/a});
    const geometry=item=>[...pathsFor(scene,item).flat(),...[-1,1].flatMap(sx=>[-1,1].map(sy=>({x:item.x+sx*item.width/2,y:item.y+sy*item.height/2})))];
    for(let i=0;i<scene.layout.length;i++){
      const time=i===0?scene.layout[1].start*.95:scene.layout[i].start+scene.settings.pace*.94,bounds=bbox(geometry(scene.layout[i]).map(p=>projectPoint(scene,time,p)));
      assert.ok(bounds.left>=scene.width*.02&&bounds.right<=scene.width*.98&&bounds.top>=scene.height*.02&&bounds.bottom<=scene.height*.98,`${shape}/${mode}/${aspect}: full highlight must remain safely visible`);
    }
    for(let step=0;step<=72;step++){
      const time=scene.duration*step/72,visible=scene.layout.filter(item=>intersects(bbox(geometry(item).map(p=>projectPoint(scene,time,p))),scene));
      assert.ok(visible.length<=1,`${shape}/${mode}/${aspect}: two highlighted sentences appeared together at ${time}`);
    }
    scene.dispose();
  }
});
