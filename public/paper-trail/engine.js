/** Paper Trail's deterministic paper-camera renderer. Times are seconds; layout uses paper coordinates. */
export const DEFAULTS = Object.freeze({
  lines: Object.freeze(['My name is', 'Ali and I will blow', 'Your mind']),
  mode: 'tilted', pace: 1.8, hold: 0.8, paper: 'ivory', ink: '#242424',
  accent: '#d29a31', textSize: 54, arrowSize: 1, texture: 0.35, aspect: '9:16', seed: 17,
  curve: 0.65, curveDirection: 'alternate', travel: 0.72, easeIn: 0.40, easeOut: 0.45,
  cameraSmooth: 0.70, paperMotion: 0.35, paperSpeed: 0.55, edgeBlur: 0.35,
  blurWidth: 0.28, focusY: 0.50, spacing: 1.15, frameRate: 60,
  arrowWidth: 8, circleWidth: 7, arrowStyle: 'solid', circleStyle: 'solid', dotSpacing: 14,
  highlightShape: 'circle', underlinePasses: 2, boxEdges: 'brackets', boxFill: true,
  highlightFill: '#f0ce45', fillOpacity: 0.62,
});

const COLORS = {
  ivory: {base: '#f6f4ed', rgb: [246, 244, 237], body: '#858078'},
  white: {base: '#f9f9f7', rgb: [249, 249, 247], body: '#888883'},
  kraft: {base: '#dfcfaf', rgb: [223, 207, 175], body: '#847763'},
  aged: {base: '#eee5d0', rgb: [238, 229, 208], body: '#8a7e69'},
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const number = (v, fallback, lo, hi) => Number.isFinite(Number(v)) ? clamp(Number(v), lo, hi) : fallback;
const smoother = (v) => {const x = clamp(v, 0, 1); return x*x*x*(x*(x*6 - 15) + 10);};
const mix = (a, b, p) => a + (b - a) * p;
const validColor = (s, fallback) => typeof s === 'string' && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(s) ? s : fallback;
function random(seed) {let a = seed >>> 0; return () => {a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296;};}

export function normalizeSettings(raw = {}) {
  const source = Array.isArray(raw.lines) ? raw.lines : typeof raw.lines === 'string' ? raw.lines.split(/\r?\n/) : DEFAULTS.lines;
  return {
    lines: source.filter((v) => typeof v === 'string' && v.trim()).slice(0, 20),
    mode: ['tilted', 'crawl', 'topdown', 'top-down'].includes(raw.mode) ? (raw.mode === 'top-down' ? 'topdown' : raw.mode) : DEFAULTS.mode,
    pace: number(raw.pace, DEFAULTS.pace, 0.6, 6),
    hold: number(raw.hold, DEFAULTS.hold, 0, 5),
    paper: Object.hasOwn(COLORS, raw.paper) ? raw.paper : DEFAULTS.paper,
    ink: validColor(raw.ink, DEFAULTS.ink), accent: validColor(raw.accent, DEFAULTS.accent),
    textSize: number(raw.textSize, DEFAULTS.textSize, 24, 110),
    arrowSize: number(raw.arrowSize, DEFAULTS.arrowSize, 0.3, 2.5),
    arrowWidth: number(raw.arrowWidth, DEFAULTS.arrowWidth, 1, 24),
    circleWidth: number(raw.circleWidth, DEFAULTS.circleWidth, 1, 24),
    arrowStyle: ['solid', 'dotted'].includes(raw.arrowStyle) ? raw.arrowStyle : DEFAULTS.arrowStyle,
    circleStyle: ['solid', 'dotted'].includes(raw.circleStyle) ? raw.circleStyle : DEFAULTS.circleStyle,
    dotSpacing: number(raw.dotSpacing, DEFAULTS.dotSpacing, 4, 40),
    highlightShape: ['circle', 'underline', 'box'].includes(raw.highlightShape) ? raw.highlightShape : DEFAULTS.highlightShape,
    underlinePasses: Number(raw.underlinePasses) === 1 ? 1 : 2,
    boxEdges: ['brackets', 'full'].includes(raw.boxEdges) ? raw.boxEdges : DEFAULTS.boxEdges,
    boxFill: typeof raw.boxFill === 'boolean' ? raw.boxFill : DEFAULTS.boxFill,
    highlightFill: validColor(raw.highlightFill, DEFAULTS.highlightFill),
    fillOpacity: number(raw.fillOpacity, DEFAULTS.fillOpacity, 0, 1),
    texture: number(raw.texture, DEFAULTS.texture, 0, 1),
    aspect: ['9:16', '1:1', '16:9', '4:5', '3:4'].includes(raw.aspect) ? raw.aspect : DEFAULTS.aspect,
    seed: number(raw.seed, DEFAULTS.seed, 0, 4294967295) >>> 0,
    curve: number(raw.curve, DEFAULTS.curve, 0, 1),
    curveDirection: ['left', 'right', 'alternate'].includes(raw.curveDirection) ? raw.curveDirection : DEFAULTS.curveDirection,
    travel: number(raw.travel, DEFAULTS.travel, 0.45, 0.90),
    easeIn: number(raw.easeIn, DEFAULTS.easeIn, 0.1, 0.75),
    easeOut: number(raw.easeOut, DEFAULTS.easeOut, 0.1, 0.75),
    cameraSmooth: number(raw.cameraSmooth, DEFAULTS.cameraSmooth, 0, 1),
    paperMotion: number(raw.paperMotion, DEFAULTS.paperMotion, 0, 1),
    paperSpeed: number(raw.paperSpeed, DEFAULTS.paperSpeed, 0.2, 1.5),
    edgeBlur: number(raw.edgeBlur, DEFAULTS.edgeBlur, 0, 1),
    blurWidth: number(raw.blurWidth, DEFAULTS.blurWidth, 0.1, 0.48),
    focusY: number(raw.focusY, DEFAULTS.focusY, 0.3, 0.7),
    spacing: number(raw.spacing, DEFAULTS.spacing, 1, 1.8),
    frameRate: Number(raw.frameRate) === 30 ? 30 : 60,
  };
}
export function getDuration(raw = DEFAULTS) {const s = normalizeSettings(raw); return Math.max(0.6, s.lines.length * s.pace + s.hold);}

let measureContext;
function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;}
  return null;
}
function measure(text, size, bold = false) {
  if (!measureContext) measureContext = makeCanvas(1, 1)?.getContext('2d');
  if (measureContext) {measureContext.font = `${bold ? 700 : 400} ${size}px Georgia, 'Times New Roman', serif`; return measureContext.measureText(text).width;}
  // This fallback keeps the layout API usable in non-browser validation.
  return [...text].reduce((n, c) => n + (/[MW@#%]/.test(c) ? 0.91 : /[ilI.,'! :;]/.test(c) ? 0.29 : /[A-Z]/.test(c) ? 0.68 : 0.5), 0) * size * (bold ? 1.045 : 1);
}
function wrap(text, size, maxWidth) {
  const words = text.split(/(\s+)/u); const rows = []; let row = '';
  for (const word of words) {
    if (!word.trim()) {row += word; continue;}
    if (measure(row + word, size, true) <= maxWidth) {row += word; continue;}
    if (row.trim()) {rows.push(row.trimEnd()); row = '';}
    if (measure(word, size, true) <= maxWidth) {row = word; continue;}
    // Long unspaced words, URLs and scripts still remain completely visible.
    for (const char of [...word]) {if (row && measure(row + char, size, true) > maxWidth) {rows.push(row); row = '';} row += char;}
  }
  if (row.trim()) rows.push(row.trimEnd());
  return rows.length ? rows : [''];
}

const BODY = [
  'Every good story begins with a small observation. The ordinary things around us hold more possibilities than we first imagine. A quiet moment becomes an idea, and an idea becomes something worth sharing.',
  'I have always been curious about what happens next. There is a certain beauty in starting before every answer is clear. Some days the path feels simple; other days it takes a little more courage.',
  'The details are what make it memorable. A conversation, a page in a notebook, a thought that stays with you long after the day is done. We keep the things that matter and follow where they lead.',
  'Nothing here happened all at once. It started with paying attention, asking a better question, and making a small change. The next chapter is waiting somewhere between an ordinary morning and a new possibility.',
  'Sometimes the most interesting direction is the one we almost missed. We look again, connect the pieces, and see the familiar in a different light. There is always another way to tell the story.',
];

export function createScene(raw = DEFAULTS, options = {}) {
  const settings = normalizeSettings(raw);
  const ratio = settings.aspect.split(':').map(Number);
  const width = Math.max(64, Math.round(Number(options.width) || 720));
  const height = Math.max(64, Math.round(Number(options.height) || width * ratio[1] / ratio[0]));
  const size = settings.textSize;
  const layout = settings.lines.map((text, index) => {
    let wrapWidth = 810, rows = wrap(text, size, wrapWidth);
    if (settings.highlightShape === 'underline') {
      // Two very heavy strokes cannot fit under unlimited narrow text rows.
      // Reflow a long underline selection wider before fitting it, retaining
      // every word while leaving a real share of the frame for the lettering.
      const strokePx = settings.circleWidth * Math.min(width, height) / 1080;
      const rowInk = strokePx * (settings.underlinePasses === 2 ? 2.45 : 1);
      const rowLimit = Math.max(2, 1 + Math.floor(height * 0.72 * 0.40 / rowInk));
      for (let i = 0; rows.length > rowLimit && i < 6; i++) {
        wrapWidth *= rows.length / rowLimit * 1.04;
        rows = wrap(text, size, wrapWidth);
      }
    }
    const widths = rows.map((row) => measure(row, size, true));
    const phraseWidth = Math.max(...widths, 1);
    const lineHeight = settings.highlightShape === 'underline' && rows.length > 1 ? size * 1.7 : size * 1.25;
    const phraseHeight = size * 1.25 + (rows.length - 1) * lineHeight;
    // Each sentence returns to the same reading column after the curved journey.
    const x = 0; const y = 0;
    return {index, text, rows, widths, x, y, width: phraseWidth, height: phraseHeight, lineHeight, rx: phraseWidth / 2 + 27, ry: phraseHeight / 2 + 12, start: index * settings.pace};
  });
  let framing = frameForLayout(settings, layout, width, height);
  // Give wrapped underlines their own inter-line space, including the selected
  // visible stroke weight. This preserves descenders and the next row's letters.
  if (settings.highlightShape === 'underline') {
    for (let iteration = 0; iteration < 32; iteration++) {
      const strokeWorld = settings.circleWidth * Math.min(width, height) / 1080 / framing.scale;
      const gap = Math.max(size * 0.12, strokeWorld * 1.45);
      const needed = size * 1.36 + strokeWorld + (settings.underlinePasses === 2 ? gap : 0);
      let changed = false;
      for (const item of layout) if (item.rows.length > 1 && item.lineHeight + 0.001 < needed) {
        item.lineHeight = needed;
        item.height = size * 1.25 + (item.rows.length - 1) * item.lineHeight;
        item.ry = item.height / 2 + 12; changed = true;
      }
      if (!changed) break;
      framing = frameForLayout(settings, layout, width, height);
    }
  }
  layout.forEach((item, index) => {item.y = index * framing.spacing;});
  for (const item of layout) {
    item.circle = circlePoints(item);
    item.highlightPaths = makeHighlightPaths(settings, item, framing.scale, Math.min(width, height) / 1080);
    const allPoints = item.highlightPaths.flat();
    item.highlightBounds = {left: Math.min(...allPoints.map(p => p.x)), right: Math.max(...allPoints.map(p => p.x)),
      top: Math.min(...allPoints.map(p => p.y)), bottom: Math.max(...allPoints.map(p => p.y))};
  }
  const paperWidth = Math.max(2400, width / framing.scale * 2.8); const bodySize = size * 0.87; const bodyLineHeight = bodySize * 1.24;
  const totalHeight = (layout.at(-1)?.y || 0) + height / framing.scale + 1900;
  const paragraphs = [];
  let bodyY = -height / framing.scale - 1700; let paragraphIndex = 0;
  while (bodyY < totalHeight) {
    const bodyText = BODY[(paragraphIndex + settings.seed) % BODY.length];
    const words = bodyText.split(' '); let row = ''; let rowIndex = 0;
    const indent = paragraphIndex % 2 === 0 ? 65 : 0;
    for (const word of words) {
      const candidate = row ? `${row} ${word}` : word;
      if (row && measure(candidate, bodySize) > paperWidth - 90 - (rowIndex === 0 ? indent : 0)) {
        paragraphs.push({text: row, x: -paperWidth / 2 + (rowIndex === 0 ? indent : 0), y: bodyY, size: bodySize});
        bodyY += bodyLineHeight; row = word; rowIndex++;
      } else row = candidate;
    }
    if (row) {paragraphs.push({text: row, x: -paperWidth / 2 + (rowIndex === 0 ? indent : 0), y: bodyY, size: bodySize}); bodyY += bodyLineHeight;}
    bodyY += bodyLineHeight * 1.25; paragraphIndex++;
  }
  // Reserve the entire line on the paper, rather than painting a flat patch over its texture.
  // Body glyphs rise above their baseline, so reserve the space below each phrase as well.
  const reservedBands = layout.map((item) => ({
    top: Math.min(item.y - item.height / 2 - bodyLineHeight * 0.18,
      settings.highlightShape === 'underline' ? item.highlightBounds.top - bodySize * 0.15 : Infinity),
    bottom: Math.max(item.y + item.height / 2 + bodySize * 0.90,
      settings.highlightShape === 'underline' ? item.highlightBounds.bottom + bodySize * 0.90 : -Infinity),
  }));
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    if (reservedBands.some((band) => paragraphs[i].y >= band.top && paragraphs[i].y <= band.bottom)) paragraphs.splice(i, 1);
  }
  for (const paragraph of paragraphs) {
    paragraph.fragments = [];
    const words = paragraph.text.split(' '); let fragment = '', offset = 0;
    for (const word of words) {
      const candidate = fragment ? `${fragment} ${word}` : word;
      if (measure(candidate, paragraph.size) > 340 && fragment) {
        paragraph.fragments.push({text: fragment, x: paragraph.x + offset});
        offset += measure(fragment + ' ', paragraph.size); fragment = word;
      } else fragment = candidate;
    }
    if (fragment) paragraph.fragments.push({text: fragment, x: paragraph.x + offset});
  }
  for (const item of layout) {
    item.leftContext = 'a thought worth sharing. ';
    item.leftContextWidth = measure(item.leftContext, bodySize);
  }
  for (const item of layout) item.connector = item.index > 0 ? connectorPoints(layout[item.index - 1], item, settings, width / framing.scale) : null;
  const scene = {settings, width, height, layout, paragraphs, reservedBands, duration: getDuration(settings), paperWidth, cameraScale: framing.scale, focal: framing.focal, spacing: framing.spacing, textureCanvas: null, blurSource: null, blurLayer: null, blurMask: null, textCache: new Map(), strokeDotCache: new WeakMap(),
    dispose() {for (const key of ['textureCanvas','blurSource','blurLayer','blurMask']) if (this[key]) {this[key].width = 1; this[key].height = 1; this[key] = null;} for(const sprite of this.textCache.values()) {sprite.canvas.width=1;sprite.canvas.height=1;} this.textCache.clear(); this.strokeDotCache = new WeakMap();}
  };
  return scene;
}

export function getActiveLine(scene, time) {return scene.layout.length ? clamp(Math.floor(Math.max(0, time) / scene.settings.pace), 0, scene.layout.length - 1) : -1;}

function modeAngles(mode) {
  return {rotation: mode === 'tilted' ? -0.20 : mode === 'crawl' ? -0.035 : 0,
    pitch: mode === 'tilted' ? 0.19 : mode === 'crawl' ? 0.64 : 0};
}
function boundsFor(camera, item) {
  // Include the whole oval and the text rectangle, not just its centre.
  const points = item.highlightPaths?.flat() || item.circle || circlePoints(item);
  const projected = points.map((p) => project(camera, p.x, p.y));
  for (const x of [-item.width / 2, item.width / 2]) for (const y of [-item.height / 2, item.height / 2]) projected.push(project(camera, item.x + x, item.y + y));
  return {left: Math.min(...projected.map(p => p.x)), right: Math.max(...projected.map(p => p.x)),
    top: Math.min(...projected.map(p => p.y)), bottom: Math.max(...projected.map(p => p.y))};
}
function frameForLayout(settings, layout, width, height) {
  const {rotation, pitch} = modeAngles(settings.mode);
  const base = Math.min(width / 720 * 1.04, height / 720 * 0.92);
  let scale = base;
  for (const item of layout) {
    const rotatedW = (item.width + 100) * Math.cos(rotation) + (item.height + 100) * Math.abs(Math.sin(rotation));
    const rotatedH = (item.height + 100) * Math.cos(rotation) + (item.width + 100) * Math.abs(Math.sin(rotation));
    scale = Math.min(scale, width * 0.76 / rotatedW, height * (settings.highlightShape === 'underline' ? 0.72 : 0.34) / rotatedH);
  }
  // A perspective horizon inside the picture would leave old sentences visible forever.
  // Relate focal distance to the viewport at the selected scale, even for a very long phrase.
  const focal = Math.max(1600, height / scale * 1.65);
  const largest = {width: Math.max(1, ...layout.map(i => i.width)), height: Math.max(settings.textSize*1.25, ...layout.map(i => i.height))};
  // Reserve a whole projected viewport BETWEEN the ovals, including their full height.
  // Comparing only their centres at rest would still put two sentences in view halfway down.
  const maxRotation=Math.abs(rotation)+settings.paperMotion*0.030, maxPitch=pitch+settings.paperMotion*0.016, minScale=scale*(1-settings.paperMotion*0.006);
  const inverseY=(screenY)=>screenY*focal/(minScale*Math.cos(maxPitch)*focal+screenY*Math.sin(maxPitch));
  const visibleDepth=inverseY(height*(1-settings.focusY+0.06))-inverseY(-height*(settings.focusY+0.06));
  const phraseDepth=(largest.width/2+34)*Math.sin(maxRotation)+(largest.height/2+20)*Math.cos(maxRotation);
  const spacing=(visibleDepth+phraseDepth*2)/Math.cos(maxRotation)*1.035*settings.spacing;
  return {scale, focal, spacing};
}
function samplePath(points, progress) {
  const fractional = clamp(progress, 0, 1) * (points.length-1);
  const index = Math.min(points.length-2, Math.floor(fractional));
  const p = fractional-index;
  return {x: mix(points[index].x, points[index+1].x,p), y: mix(points[index].y, points[index+1].y,p)};
}
// Integral of a smooth velocity ramp. Unlike three separate ease pulses, this
// accelerates once, travels without an internal halt, then decelerates once.
function ramp(v, smoothing) {
  const x=clamp(v,0,1);
  const rounded=x**4*(35-84*x+70*x*x-20*x*x*x);
  return mix(smoother(x),rounded,smoothing);
}
function rampIntegral(v, smoothing) {
  const x=clamp(v,0,1);
  return mix(x**6-3*x**5+2.5*x**4,7*x**5-14*x**6+10*x**7-2.5*x**8,smoothing);
}
function movementTiming(settings) {
  const sum=settings.easeIn+settings.easeOut;
  const ratio=sum>0.90?0.90/sum:1;
  return {travel:settings.travel,duration:settings.pace*settings.travel,
    easeIn:settings.easeIn*ratio,easeOut:settings.easeOut*ratio};
}
function movementAt(settings, u) {
  const timing=movementTiming(settings), a=timing.easeIn,b=timing.easeOut;
  const x=clamp(u,0,1), area=1-(a+b)/2, smoothing=settings.cameraSmooth;
  let position,velocity;
  if(x<a) {position=a*rampIntegral(x/a,smoothing);velocity=ramp(x/a,smoothing);}
  else if(x<=1-b) {position=a/2+x-a;velocity=1;}
  else {position=a/2+(1-a-b)+b*(0.5-rampIntegral((1-x)/b,smoothing));velocity=ramp((1-x)/b,smoothing);}
  return {progress:position/area,velocity:velocity/area,timing};
}
function evaluateConnector(points, progress) {
  if(points.curve) return bezier(...points.curve,mix(points.start,points.end,clamp(progress,0,1)));
  return samplePath(points,progress);
}
function derivative(curve,t) {
  const [a,b,c,d]=curve,q=1-t;
  return {x:3*q*q*(b.x-a.x)+6*q*t*(c.x-b.x)+3*t*t*(d.x-c.x),
    y:3*q*q*(b.y-a.y)+6*q*t*(c.y-b.y)+3*t*t*(d.y-c.y)};
}
function transitionAt(scene, time) {
  const activeIndex=getActiveLine(scene,time);
  const target=scene.layout[activeIndex] || {x:0,y:0};
  const timing=movementTiming(scene.settings);
  if(activeIndex<=0) return {activeIndex,phase:'hold',progress:1,journeyProgress:1,arrowProgress:0,
    focus:{x:target.x,y:target.y},arrowWorld:null,speed:0,velocity:{x:0,y:0},timing};
  const points=target.connector, local=time-target.start;
  const movement=movementAt(scene.settings,local/timing.duration);
  const q=movement.progress,arrowProgress=clamp((q-points.start)/(points.end-points.start),0,1);
  const focus=bezier(...points.curve,q);
  const tangent=derivative(points.curve,q), rate=movement.velocity/timing.duration;
  const velocity=local>=timing.duration?{x:0,y:0}:{x:tangent.x*rate,y:tangent.y*rate};
  const phase=local>=timing.duration?'hold':q<points.start?'depart':q>points.end?'arrive':'travel';
  return {activeIndex,phase,progress:clamp(local/timing.duration,0,1),journeyProgress:q,arrowProgress,
    focus,arrowWorld:evaluateConnector(points,arrowProgress),speed:Math.hypot(velocity.x,velocity.y),velocity,timing};
}
function cameraAt(scene, time, transition=transitionAt(scene,time)) {
  const {settings,width,height}=scene,{rotation,pitch}=modeAngles(settings.mode);
  const amplitude=settings.paperMotion, clock=time*settings.paperSpeed;
  const drift=Math.sin(clock*Math.PI*2/5.2), shortEdge=Math.min(width,height);
  return {x:transition.focus.x,y:transition.focus.y,scale:scene.cameraScale*(1+drift*amplitude*0.006),
    rotation:rotation+Math.sin(clock*Math.PI*2/5.8)*amplitude*0.030,
    pitch:pitch+Math.sin(clock*Math.PI*2/6.7)*amplitude*0.016,
    focal:scene.focal,screenX:width/2+Math.sin(clock*Math.PI*2/6.1)*shortEdge*amplitude*0.012,
    screenY:height*settings.focusY+Math.sin(clock*Math.PI*2/7.3)*shortEdge*amplitude*0.009};
}
function blurAt(scene,transition,camera) {
  const velocity=transition.speed*camera.scale;
  return {amount:scene.settings.edgeBlur*clamp(velocity/(scene.height*1.2),0,1),
    width:scene.settings.blurWidth,velocity,
    dx:transition.velocity.x*camera.scale,dy:transition.velocity.y*camera.scale};
}
/** Pure diagnostics evaluate the very same analytic path, envelope and camera as rendering. */
export function getFrameState(scene,time=0) {
  const t=clamp(Number(time)||0,0,scene.duration);
  const transition=transitionAt(scene,t),camera=cameraAt(scene,t,transition);
  const arrowTip=transition.arrowWorld?{world:{...transition.arrowWorld},screen:project(camera,transition.arrowWorld.x,transition.arrowWorld.y)}:null;
  const phraseBounds=scene.layout.map(item=>({index:item.index,...boundsFor(camera,item)}));
  const visiblePhraseIndices=phraseBounds.filter(b=>b.right>=0&&b.left<=scene.width&&b.bottom>=0&&b.top<=scene.height).map(b=>b.index);
  const connector=scene.layout[transition.activeIndex]?.connector;
  return {time:t,camera,activeIndex:transition.activeIndex,phase:transition.phase,transitionProgress:transition.progress,
    journeyProgress:transition.journeyProgress,arrowProgress:transition.arrowProgress,arrowTip,
    focalPoint:{x:camera.screenX,y:camera.screenY},phraseBounds,visiblePhraseIndices,
    speed:transition.speed,timing:transition.timing,
    curve:connector?{direction:connector.direction,bend:connector.bend}:null,
    paperMotion:{amount:scene.settings.paperMotion,speed:scene.settings.paperSpeed},
    blur:blurAt(scene,transition,camera),
    strokes:{arrow:getStrokeStyle(scene,'arrow'),circle:getStrokeStyle(scene,'circle')},
    texturePhase:{x:-camera.x,y:-camera.y,rotation:camera.rotation,scale:camera.scale}};
}
export function projectPoint(scene,time,point) {const t=clamp(Number(time)||0,0,scene.duration);return project(cameraAt(scene,t),point.x,point.y);}
function project(camera, x, y) {
  const dx = x - camera.x, dy = y - camera.y;
  const cos = Math.cos(camera.rotation), sin = Math.sin(camera.rotation);
  const xr = dx * cos - dy * sin, yr = dx * sin + dy * cos;
  const depth = camera.focal - yr * Math.sin(camera.pitch);
  const perspective = camera.focal / Math.max(camera.focal * 0.19, depth);
  return {x: camera.screenX + xr * camera.scale * perspective, y: camera.screenY + yr * Math.cos(camera.pitch) * camera.scale * perspective, depth};
}
function localTransform(ctx, camera, x, y) {
  const p = project(camera, x, y), px = project(camera, x + 1, y), py = project(camera, x, y + 1);
  ctx.setTransform(px.x - p.x, px.y - p.y, py.x - p.x, py.y - p.y, p.x, p.y);
}
function textSprite(scene,text,size,color,bold) {
  if(!scene)return null;
  const key=`${size}|${bold}|${color}|${text}`;
  if(scene.textCache.has(key))return scene.textCache.get(key);
  if(scene.textCache.size>=256)return null;
  const ratio=clamp(scene.cameraScale*1.4,1,3),padding=3;
  const width=Math.ceil(measure(text,size,bold)+padding*2),height=Math.ceil(size*1.65+padding*2),baseline=size*1.15+padding;
  const canvas=makeCanvas(Math.ceil(width*ratio),Math.ceil(height*ratio)),context=canvas?.getContext('2d');
  if(!context)return null;
  context.scale(ratio,ratio);context.font=`${bold?700:400} ${size}px Georgia, 'Times New Roman', serif`;
  context.fillStyle=color;context.textBaseline='alphabetic';context.fillText(text,padding,baseline);
  const sprite={canvas,width,height,baseline,padding};scene.textCache.set(key,sprite);return sprite;
}
function drawText(ctx, camera, text, x, y, size, color, bold = false, scene = null) {
  const p = project(camera, x, y);
  if (p.depth < camera.focal * 0.24 || p.y < -160 || p.y > ctx.canvas.height + 160) return;
  localTransform(ctx, camera, x, y);
  const sprite=textSprite(scene,text,size,color,bold);
  if(sprite) {ctx.drawImage(sprite.canvas,-sprite.padding,-sprite.baseline,sprite.width,sprite.height);return;}
  ctx.font = `${bold ? 700 : 400} ${size}px Georgia, 'Times New Roman', serif`;
  ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 0, 0);
}
function paperTexture(scene) {
  const canvas = makeCanvas(384, 384); if (!canvas) return null;
  const ctx = canvas.getContext('2d'); if (!ctx) return null;
  const image = ctx.createImageData(384, 384); const rng = random(scene.settings.seed ^ 0x61A9);
  const base = COLORS[scene.settings.paper].rgb;
  for (let i = 0; i < image.data.length; i += 4) {
    const v = (rng() - 0.5) * 17 * scene.settings.texture;
    image.data[i] = base[0] + v; image.data[i + 1] = base[1] + v; image.data[i + 2] = base[2] + v; image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  ctx.strokeStyle = `rgba(100,91,72,${0.045 * scene.settings.texture})`; ctx.lineWidth = 0.5;
  for (let i = 0; i < 460; i++) {const x = rng() * 384, y = rng() * 384; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rng() * 24 + 3, y + (rng() - 0.5) * 2); ctx.stroke();}
  return canvas;
}
function drawPaper(ctx, scene, camera) {
  const {width, height} = scene;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  ctx.fillStyle = COLORS[scene.settings.paper].base; ctx.fillRect(0, 0, width, height);
  if (scene.settings.texture > 0) {
    scene.textureCanvas ||= paperTexture(scene);
    if (scene.textureCanvas) {
      const pattern = ctx.createPattern(scene.textureCanvas, 'repeat');
      // Use one continuous plane transform. Projecting a distant origin and then
      // taking its modulo made the texture slide at a different speed to the text.
      ctx.save(); const scale = camera.scale;
      ctx.translate(camera.screenX,camera.screenY); ctx.rotate(camera.rotation);
      ctx.scale(scale,scale*Math.cos(camera.pitch)); ctx.translate(-camera.x,-camera.y);
      ctx.fillStyle=pattern; const extent=(width+height)/scale*2;
      ctx.fillRect(camera.x-extent,camera.y-extent,extent*2,extent*2); ctx.restore();
    }
  }
  // Broad soft shading, as light skims the paper; never a fake page edge.
  const light = ctx.createLinearGradient(0, 0, width, height);
  light.addColorStop(0, 'rgba(255,255,255,0.16)'); light.addColorStop(0.55, 'rgba(255,255,255,0)'); light.addColorStop(1, 'rgba(92,78,47,0.026)');
  ctx.fillStyle = light; ctx.fillRect(0, 0, width, height);
}
function circlePoints(item) {
  const points = []; const phase = item.index * 1.73;
  for (let i = 0; i <= 130; i++) {
    const angle = -Math.PI * 0.68 + i / 130 * Math.PI * 2.06;
    const wobble = 1 + Math.sin(angle * 3 + phase) * 0.013 + Math.sin(angle * 7 - phase) * 0.006;
    points.push({x: item.x + Math.cos(angle) * item.rx * wobble + Math.sin(angle) * 4, y: item.y + Math.sin(angle) * item.ry * wobble});
  }
  return points;
}
function polylinePoints(vertices, spacing = 4) {
  const points = [{...vertices[0]}];
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1], b = vertices[i], steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / spacing));
    for (let j = 1; j <= steps; j++) points.push({x: mix(a.x, b.x, j / steps), y: mix(a.y, b.y, j / steps)});
  }
  return points;
}
function makeHighlightPaths(settings, item, scale, resolution) {
  if (settings.highlightShape === 'circle') return [item.circle];
  if (settings.highlightShape === 'box') {
    const left = item.x - item.width / 2 - 22, right = item.x + item.width / 2 + 22;
    const top = item.y - item.height / 2 - 6, bottom = item.y + item.height / 2 + 4;
    if (settings.boxEdges === 'full') return [polylinePoints([
      {x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom},{x:left,y:top},
    ])];
    const cap = Math.max(10, Math.min(22, settings.textSize * 0.32, (right - left) * 0.2));
    return [
      polylinePoints([{x:left+cap,y:top},{x:left,y:top},{x:left,y:bottom},{x:left+cap,y:bottom}]),
      polylinePoints([{x:right-cap,y:top},{x:right,y:top},{x:right,y:bottom},{x:right-cap,y:bottom}]),
    ];
  }
  const size = settings.textSize, strokeWorld = settings.circleWidth * resolution / scale;
  const gap = Math.max(size * 0.12, strokeWorld * 1.45), paths = [];
  item.rows.forEach((row, rowIndex) => {
    const baseline = item.y - item.height / 2 + size * 0.86 + rowIndex * item.lineHeight;
    const left = item.x - item.widths[rowIndex] / 2 - 5, right = item.x + item.widths[rowIndex] / 2 + 5;
    const y = baseline + size * 0.26 + strokeWorld / 2;
    const phase = item.index * 1.31 + rowIndex * 0.77;
    const first = Array.from({length:81}, (_, i) => {
      const u = i / 80;
      return {x:mix(left,right,u),y:y + Math.sin(u*Math.PI*1.35+phase)*size*0.017 + (u-.5)*size*0.01};
    });
    paths.push(first);
    if (settings.underlinePasses === 2) paths.push(Array.from({length:49}, (_, i) => {
      const u = i / 48;
      return {x:mix(mix(left,right,0.84),mix(left,right,0.15),u),
        y:y + gap + Math.sin(u*Math.PI*1.45+phase+0.7)*size*0.020 - (u-.5)*size*0.015};
    }));
  });
  return paths;
}
/** Paper-space mark geometry shared by preview, export, dots and diagnostics. */
export function getHighlightPaths(scene, item) {
  return item.highlightPaths || makeHighlightPaths(scene.settings, item, scene.cameraScale, Math.min(scene.width, scene.height) / 1080);
}
function highlightProgress(scene, item, time) {
  const {settings} = scene;
  const start = item.start + (item.index === 0 ? settings.pace * 0.05 : settings.pace * (settings.travel - 0.025));
  return smoother((time - start) / (settings.pace * Math.min(0.19, 0.98 - settings.travel)));
}
/** The already-eased reveal moves complete bracket marks apart around one fixed centre. */
export function getBoxReveal(scene, item, progress) {
  if (scene.settings.highlightShape !== 'box') return null;
  const paths=getHighlightPaths(scene,item), points=paths.flat();
  const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x));
  const center=item.x,half=(right-left)/2,p=clamp(progress,0,1);
  const stroke=getStrokeStyle(scene,'circle').widthPx/scene.cameraScale;
  const cap=scene.settings.boxEdges==='brackets'?Math.max(...paths[0].map(p=>p.x))-Math.min(...paths[0].map(p=>p.x)):0;
  const initialHalf=Math.min(half,Math.max(cap+stroke*.75+2,stroke*1.5+2));
  const extent=mix(initialHalf,half,p),opacity=smoother(clamp(p/.08,0,1));
  const transforms=scene.settings.boxEdges==='brackets'
    ? [{offsetX:center-extent-left,originX:center,scaleX:1,opacity},{offsetX:center+extent-right,originX:center,scaleX:1,opacity}]
    : [{offsetX:0,originX:center,scaleX:half>0?extent/half:1,opacity}];
  return {progress:p,centerX:center,left:center-extent,right:center+extent,opacity,transforms};
}
function drawHighlightFill(ctx, scene, camera, item, progress) {
  const {settings} = scene;
  if (settings.highlightShape !== 'box' || !settings.boxFill || settings.fillOpacity <= 0 || progress <= 0) return;
  ctx.save(); ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle = settings.highlightFill; ctx.globalAlpha = settings.fillOpacity;
  const size = settings.textSize, reveal = clamp(progress, 0, 1);
  item.rows.forEach((row, rowIndex) => {
    const baseline = item.y - item.height / 2 + size * 0.86 + rowIndex * item.lineHeight;
    const left = item.x - item.widths[rowIndex] / 2 - 8, right = item.x + item.widths[rowIndex] / 2 + 8;
    const top = baseline - size * 0.81, bottom = baseline + size * 0.15;
    const phase = item.index * 0.83 + rowIndex * 1.27;
    const from=(1-reveal)/2,to=(1+reveal)/2;
    const knots = [from,...[0,0.19,0.41,0.63,0.82,1].filter(u => u > from && u < to),to];
    const topAt = u => top + Math.sin(u*11+phase)*size*0.018;
    const bottomAt = u => bottom + Math.sin(u*9+phase+0.8)*size*0.016;
    const polygon = knots.map(u => ({x:mix(left,right,u),y:topAt(u)}));
    polygon.push(...[...knots].reverse().map(u => ({x:mix(left,right,u),y:bottomAt(u)})));
    ctx.beginPath();
    polygon.forEach((point, index) => {const p = project(camera,point.x,point.y); if(index === 0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});
    ctx.closePath?.(); ctx.fill();
  });
  ctx.restore();
}
function drawHighlight(ctx, scene, camera, item, progress) {
  if (progress <= 0) return;
  const paths = getHighlightPaths(scene, item);
  if (scene.settings.highlightShape === 'box') {
    const reveal=getBoxReveal(scene,item,progress);
    paths.forEach((path,index)=>drawPath(ctx,scene,camera,path,1,scene.settings.accent,'circle',reveal.transforms[index]));
    return;
  }
  const lengths = paths.map(path => path.slice(1).reduce((n,p,i) => n + Math.hypot(p.x-path[i].x,p.y-path[i].y),0));
  const total = lengths.reduce((a,b) => a+b,0);
  let remaining = progress * total;
  paths.forEach((path, index) => {
    if (remaining <= 0) return;
    const local = lengths[index] ? clamp(remaining / lengths[index],0,1) : 1;
    drawPath(ctx, scene, camera, path, local, scene.settings.accent, 'circle');
    remaining -= lengths[index];
  });
}
function bezier(a, b, c, d, t) {const q = 1 - t; return {x: q*q*q*a.x + 3*q*q*t*b.x + 3*q*t*t*c.x + t*t*t*d.x, y: q*q*q*a.y + 3*q*q*t*b.y + 3*q*t*t*c.y + t*t*t*d.y};}
function connectorPoints(from, to, settings, viewWidth) {
  const distance = to.y - from.y;
  const direction=settings.curveDirection==='alternate'?(from.index%2===0?1:-1):settings.curveDirection==='right'?1:-1;
  const bend=direction*viewWidth*settings.curve*0.72;
  const curve=[{x:from.x,y:from.y},{x:from.x+bend,y:from.y+distance/3},
    {x:to.x+bend,y:to.y-distance/3},{x:to.x,y:to.y}];
  const outgoing = settings.highlightShape === 'circle' ? from.ry + 12 : Math.max(from.ry + 12, from.highlightBounds.bottom - from.y + 12);
  const incoming = settings.highlightShape === 'circle' ? to.ry + 18 : Math.max(to.ry + 18, to.y - to.highlightBounds.top + 18);
  const start=outgoing/distance,end=1-incoming/distance;
  const points=Array.from({length:101},(_,i)=>bezier(...curve,mix(start,end,i/100)));
  Object.assign(points,{curve,start,end,direction,bend});
  return points;
}
/** Stroke widths are output pixels at a 1080p short edge, independent of paper zoom. */
export function getStrokeStyle(scene, kind = 'arrow') {
  const key=kind==='circle'?'circle':'arrow', scale=Math.min(scene.width,scene.height)/1080;
  const width1080=scene.settings[key+'Width'];
  return {kind:key,style:scene.settings[key+'Style'],width1080,widthPx:width1080*scale,
    gap1080:scene.settings.dotSpacing,gapPx:scene.settings.dotSpacing*scale,dotDiameterPx:width1080*scale};
}

/** Fixed paper-space dot centres. The camera never re-phases the dot pattern. */
export function getPathDots(scene, points, kind = 'arrow') {
  if(!points || points.length<2)return [];
  const style=getStrokeStyle(scene,kind), cacheKey=`${kind}|${style.widthPx}|${style.gapPx}`;
  let cache=scene.strokeDotCache.get(points);
  if(!cache){cache=new Map();scene.strokeDotCache.set(points,cache);}
  if(cache.has(cacheKey))return cache.get(cacheKey);
  const lengths=[0];
  for(let i=1;i<points.length;i++)lengths.push(lengths[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));
  const totalLength=lengths.at(-1), diameterWorld=style.widthPx/scene.cameraScale;
  const step=(style.widthPx+style.gapPx)/scene.cameraScale;
  const dots=[];let segment=0;
  // Inset by a radius so the first and last dots reveal fully without popping at the end.
  for(let distance=diameterWorld/2;distance+diameterWorld/2<=totalLength+1e-8;distance+=step){
    while(segment<points.length-2 && lengths[segment+1]<distance)segment++;
    const length=lengths[segment+1]-lengths[segment];
    const fraction=length>0?(distance-lengths[segment])/length:0;
    const progress=(segment+fraction)/(points.length-1), p=evaluateConnector(points,progress);
    dots.push(Object.freeze({x:p.x,y:p.y,progress,distance}));
  }
  Object.defineProperties(dots,{totalLength:{value:totalLength},diameterWorld:{value:diameterWorld},
    lengths:{value:Object.freeze(lengths)}});
  Object.freeze(dots);cache.set(cacheKey,dots);return dots;
}

function revealedLength(dots, points, progress) {
  const f=clamp(progress,0,1)*(points.length-1), index=Math.min(points.length-2,Math.floor(f));
  return mix(dots.lengths[index],dots.lengths[index+1],f-index);
}

function drawPath(ctx, scene, camera, points, progress, color, kind = 'circle', placement = null) {
  if (progress <= 0) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = placement?.opacity ?? 1;
  const projected=point=>placement
    ? project(camera,placement.originX+(point.x-placement.originX)*placement.scaleX+placement.offsetX,point.y)
    : project(camera,point.x,point.y);
  const style=getStrokeStyle(scene,kind), arrow=kind==='arrow';
  const last = clamp(Math.floor((points.length - 1) * progress), 0, points.length - 1);
  const endpoint = evaluateConnector(points, progress);
  const squareMark = !arrow && scene.settings.highlightShape === 'box';
  ctx.strokeStyle = color; ctx.fillStyle=color; ctx.lineWidth=style.widthPx;
  ctx.lineCap=squareMark?'square':'round'; ctx.lineJoin=squareMark?'miter':'round';
  ctx.setLineDash?.([]);
  if(style.style==='dotted') {
    const dots=getPathDots(scene,points,kind), length=revealedLength(dots,points,progress);
    for(const dot of dots){
      const reveal=smoother((length-dot.distance+dots.diameterWorld/2)/dots.diameterWorld);
      if(reveal<=0)break;
      const p=projected(dot), radius=style.widthPx/2*reveal;
      if(p.depth<camera.focal*.24 || p.x<-radius || p.x>scene.width+radius || p.y<-radius || p.y>scene.height+radius)continue;
      ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fill();
    }
  } else {
    ctx.beginPath();
    for (let i = 0; i <= last; i++) {const p = projected(points[i]); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);}
    const endpointScreen = projected(endpoint); ctx.lineTo(endpointScreen.x, endpointScreen.y);
    ctx.stroke();
  }
  if (arrow && progress > 0) {
    const a = points.curve ? derivative(points.curve,mix(points.start,points.end,progress)) : null;
    const previous = a ? null : samplePath(points,Math.max(0,progress-0.025));
    const tip=project(camera,endpoint.x,endpoint.y);
    const tangent=a||{x:endpoint.x-previous.x,y:endpoint.y-previous.y};
    const next=project(camera,endpoint.x+tangent.x*.001,endpoint.y+tangent.y*.001);
    const angle=Math.atan2(next.y-tip.y,next.x-tip.x), resolution=Math.min(scene.width,scene.height)/1080;
    const size=clamp(style.widthPx*3.2,12*resolution,54*resolution);
    // Keep a solid directional head, including when the shaft is dotted.
    ctx.setLineDash?.([]);ctx.beginPath();
    ctx.moveTo(tip.x-Math.cos(angle-.55)*size,tip.y-Math.sin(angle-.55)*size);
    ctx.lineTo(tip.x,tip.y);
    ctx.lineTo(tip.x-Math.cos(angle+.55)*size,tip.y-Math.sin(angle+.55)*size);ctx.stroke();
  }
}

function drawEdgeBlur(ctx,scene,transition,camera) {
  const blur=blurAt(scene,transition,camera);
  if(blur.amount<0.0001)return;
  const {width,height}=scene,ratio=Math.min(0.5,480/width);
  const bw=Math.max(1,Math.round(width*ratio)),bh=Math.max(1,Math.round(height*ratio));
  if(!scene.blurSource) {
    scene.blurSource=makeCanvas(bw,bh);scene.blurLayer=makeCanvas(bw,bh);scene.blurMask=makeCanvas(bw,bh);
    const mask=scene.blurMask?.getContext('2d');
    if(mask) {
      const gradient=mask.createLinearGradient(0,0,bw,0),edge=scene.settings.blurWidth;
      gradient.addColorStop(0,'#fff');gradient.addColorStop(edge,'#fff0');
      gradient.addColorStop(1-edge,'#fff0');gradient.addColorStop(1,'#fff');
      mask.fillStyle=gradient;mask.fillRect(0,0,bw,bh);
    }
  }
  const source=scene.blurSource?.getContext('2d'),layer=scene.blurLayer?.getContext('2d');
  if(!source||!layer)return;
  source.setTransform(1,0,0,1,0,0);source.clearRect(0,0,bw,bh);
  source.drawImage(ctx.canvas,0,0,width,height,0,0,bw,bh);
  layer.setTransform(1,0,0,1,0,0);layer.clearRect(0,0,bw,bh);
  const angle=camera.rotation,dx=blur.dx*Math.cos(angle)-blur.dy*Math.sin(angle),dy=(blur.dx*Math.sin(angle)+blur.dy*Math.cos(angle))*Math.cos(camera.pitch);
  const length=Math.max(1,Math.hypot(dx,dy)),spread=Math.min(width*0.035,blur.velocity/45)*scene.settings.edgeBlur*ratio;
  layer.globalAlpha=0.25;
  for(const sample of [-0.75,-0.25,0.25,0.75])layer.drawImage(scene.blurSource,-dx/length*spread*sample,-dy/length*spread*sample);
  layer.globalAlpha=1;layer.globalCompositeOperation='destination-in';layer.drawImage(scene.blurMask,0,0);layer.globalCompositeOperation='source-over';
  ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=blur.amount;
  ctx.drawImage(scene.blurLayer,0,0,bw,bh,0,0,width,height);ctx.globalAlpha=1;
}

export function renderFrame(ctx, scene, time = 0) {
  const t = clamp(Number(time) || 0, 0, scene.duration);
  const {settings, layout, width, height} = scene;
  const transition = transitionAt(scene,t);
  const camera = cameraAt(scene, t, transition);
  ctx.save(); drawPaper(ctx, scene, camera);
  // Body copy remains part of the same plane as the selected phrases.
  ctx.globalAlpha = 0.69;
  for (const paragraph of scene.paragraphs) {
    if (Math.abs(paragraph.y - camera.y) > (height / camera.scale + 700) * 1.1) continue;
    // Short fragments preserve the page's perspective across the full line.
    for (const fragment of paragraph.fragments) {
      drawText(ctx, camera, fragment.text, fragment.x, paragraph.y, paragraph.size, COLORS[settings.paper].body, false, scene);
    }
  }
  ctx.globalAlpha = 1;
  // Selected words occupy a reserved inline band in the paper's running copy.
  for (const item of layout) {
    if (Math.abs(item.y - camera.y) > height / camera.scale + 600) continue;
    drawHighlightFill(ctx, scene, camera, item, highlightProgress(scene,item,t));
    const lineHeight = item.lineHeight;
    item.rows.forEach((row, i) => {
      const baseline = item.y - item.height / 2 + settings.textSize * 0.86 + i * lineHeight;
      drawText(ctx, camera, row, item.x - item.widths[i] / 2, baseline, settings.textSize, settings.ink, true, scene);
    });
    // A few body words directly beside a short selection keep it embedded in the paragraph.
    if (item.rows.length === 1) {
      ctx.globalAlpha = 0.69;
      const left = item.leftContext;
      const right = ' and the story continues.';
      const baseline = item.y - item.height / 2 + settings.textSize * 0.86;
      const bodySize = settings.textSize * 0.87;
      drawText(ctx, camera, left, item.x - item.width / 2 - item.leftContextWidth - 16, baseline, bodySize, COLORS[settings.paper].body, false, scene);
      drawText(ctx, camera, right, item.x + item.width / 2 + 16, baseline, bodySize, COLORS[settings.paper].body, false, scene);
      ctx.globalAlpha = 1;
    }
  }
  // Blur only the moving outer paper. The central reading region and drawn marks
  // stay at full resolution; the cached side pass is deterministic and has no history.
  drawEdgeBlur(ctx,scene,transition,camera);
  for (let i = 0; i < layout.length; i++) {
    const item = layout[i];
    if (Math.abs(item.y - camera.y) < height / camera.scale + 1100) drawHighlight(ctx, scene, camera, item, highlightProgress(scene,item,t));
    if (i > 0) {
      const from = layout[i - 1];
      if (Math.abs((from.y + item.y) / 2 - camera.y) < height / camera.scale + 1100) {
        const journey=movementAt(settings,(t-item.start)/(settings.pace*settings.travel)).progress;
        const progress=clamp((journey-item.connector.start)/(item.connector.end-item.connector.start),0,1);
        drawPath(ctx, scene, camera, item.connector, progress, settings.accent, 'arrow');
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  // Delicate optical softness at the outer edge without compromising the active phrase.
  const vignette = ctx.createRadialGradient(width/2, height*0.49, Math.min(width,height)*0.26, width/2, height*0.49, Math.max(width,height)*0.76);
  vignette.addColorStop(0, 'rgba(255,255,255,0)'); vignette.addColorStop(1, 'rgba(255,255,255,0.18)');
  ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
