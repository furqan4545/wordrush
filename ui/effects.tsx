import {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BorderBeam} from 'border-beam';
import {VoiceRing} from './vendor/voice-ring/src/VoiceRing';

function useMotionState() {
  const [visible, setVisible] = useState(!document.hidden);
  const [reduced, setReduced] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const onVisibility = () => setVisible(!document.hidden);
    const onMotion = () => setReduced(media.matches);
    document.addEventListener('visibilitychange', onVisibility);
    media.addEventListener('change', onMotion);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      media.removeEventListener('change', onMotion);
    };
  }, []);
  return {visible, reduced};
}

function useRendering() {
  const current = () => {
    const panel = document.getElementById('render-progress');
    return Boolean(panel && !panel.hidden);
  };
  const [rendering, setRendering] = useState(current);
  useEffect(() => {
    const sync = () => setRendering(current());
    const panel = document.getElementById('render-progress');
    const observer = new MutationObserver(sync);
    if (panel) observer.observe(panel, {attributes: true, attributeFilter: ['hidden']});
    const onRender = (event: Event) => {
      const detail = (event as CustomEvent<{loading?: boolean}>).detail;
      setRendering(typeof detail?.loading === 'boolean' ? detail.loading : current());
    };
    window.addEventListener('wordrush:render-state', onRender);
    sync();
    return () => {
      observer.disconnect();
      window.removeEventListener('wordrush:render-state', onRender);
    };
  }, []);
  return rendering;
}

function SearchHalo() {
  const rendering = useRendering();
  const {visible, reduced} = useMotionState();
  return <BorderBeam
    size={rendering ? 'line' : 'pulse-outside'}
    theme="light"
    colorVariant="ocean"
    strength={0.8}
    active={visible && !reduced}
    style={{width: '100%', height: '100%', borderRadius: 'inherit', pointerEvents: 'none'}}
  >
    <div className="search-beam-surface" style={{
      width: '100%', height: '100%', borderRadius: 'inherit',
      background: '#fffcff', border: '1px solid rgba(133, 114, 195, .18)',
    }}/>
  </BorderBeam>;
}

function RenderRing() {
  const rendering = useRendering();
  const {visible, reduced} = useMotionState();
  if (!rendering) return null;
  return <VoiceRing
    state="processing"
    size={240}
    theme="light"
    speed={0.75}
    paused={!visible || reduced}
    aria-hidden="true"
    style={{display: 'block', width: '100%', height: '100%', pointerEvents: 'none'}}
  />;
}

const halo = document.getElementById('search-glow-root');
const ring = document.getElementById('voice-ring-root');
if (halo) createRoot(halo).render(<SearchHalo/>);
if (ring) createRoot(ring).render(<RenderRing/>);
