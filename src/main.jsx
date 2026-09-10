import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './styles.css';

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
const BOUNDS = { latMin: 16.07, latMax: 23.52, lonMin: 84.10, lonMax: 92.99 };
const LABELS = [
  ['temperature', 'Temperature', '°C', 'T'],
  ['salinity', 'Salinity', 'PSU', 'S'],
  ['currents', 'Currents', 'm/s', 'C'],
  ['sea level', 'Sea Surface Height', 'm', 'SSH'],
  ['sea surface temp', 'Sea Surface Temperature', '°C', 'SST'],
  ['anom', 'SST Anomaly', '°C', 'A'],
  ['baymetry', 'Bathymetry', 'm', 'B'],
  ['chlor', 'Chlorophyll-a', 'mg/m³', 'CH'],
  ['oxygen', 'Dissolved Oxygen', 'mmol/m³', 'O₂'],
  ['ph', 'pH / Acidity', 'pH', 'pH'],
  ['wave', 'Wave Height', 'm', 'W'],
  ['wind', 'Wind', 'm/s', 'WD'],
];

function describe(variable) {
  const s = String(variable || 'Ocean field');
  const low = s.toLowerCase();
  const found = LABELS.find(([key]) => low.includes(key));
  return found ? { name: found[1], unit: found[2], icon: found[3] } : { name: s.replaceAll('_', ' '), unit: '—', icon: '•' };
}

function datasetFile(d) {
  return d?.filename || d?.file || d?.name || d?.path;
}

function variableList(response) {
  if (Array.isArray(response)) return response.map(v => typeof v === 'string' ? v : v?.name || v?.variable).filter(Boolean);
  if (Array.isArray(response?.variables)) return response.variables.map(v => typeof v === 'string' ? v : v?.name || v?.variable).filter(Boolean);
  return Object.keys(response?.variables || response || {});
}

function dimensionInfo(payload) {
  const dims = (payload?.dimensions || []).map(String);
  const shape = (payload?.shape || []).map(Number);
  const index = key => dims.findIndex(d => d.toLowerCase().includes(key));
  return { dims, shape, xi: index('longitude') >= 0 ? index('longitude') : index('lon'), yi: index('latitude') >= 0 ? index('latitude') : index('lat'), zi: index('depth') >= 0 ? index('depth') : index('lev'), ti: index('time') };
}

function getNested(root, ids) {
  let x = root;
  for (const id of ids) {
    if (!Array.isArray(x)) return NaN;
    x = x[id];
  }
  return Number(x);
}

function extractGrid(payload, timeIndex = 0) {
  const { dims, shape, xi, yi, zi, ti } = dimensionInfo(payload);
  if (xi < 0 || yi < 0) throw new Error('Backend field has no latitude/longitude dimensions');
  const nx = shape[xi];
  const ny = shape[yi];
  const nz = zi >= 0 ? shape[zi] : 1;
  const total = nx * ny * nz;
  if (!nx || !ny || total > 450000) throw new Error(`Field is too large for browser rendering (${total.toLocaleString()} values)`);
  const values = new Float32Array(total);
  let min = Infinity;
  let max = -Infinity;
  const at = (x, y, z) => {
    const ids = dims.map((_, d) => d === xi ? x : d === yi ? y : d === zi ? z : d === ti ? timeIndex : 0);
    return getNested(payload.data, ids);
  };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const value = at(x, y, z);
    const i = z * nx * ny + y * nx + x;
    values[i] = Number.isFinite(value) ? value : -9999;
    if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
  }
  if (!Number.isFinite(min)) throw new Error('Selected field contains no finite values');
  return { values, nx, ny, nz, min, max, timeCount: ti >= 0 ? shape[ti] : 1 };
}

function timeValues(payload) {
  const c = payload?.coordinates || {};
  const key = Object.keys(c).find(k => k.toLowerCase().includes('time'));
  const value = key ? c[key] : null;
  return Array.isArray(value) ? value : [];
}

const volumeVertex = `varying vec3 vUv; void main(){ vUv = position * 0.5 + 0.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const volumeFragment = `
precision highp float; precision highp sampler3D;
varying vec3 vUv;
uniform sampler3D uData; uniform float uCut; uniform vec2 uRange; uniform float uOpacity;
vec3 cmap(float t){
  vec3 a=vec3(0.03,0.08,0.48), b=vec3(0.02,0.62,0.90), c=vec3(0.98,0.87,0.20), d=vec3(0.90,0.08,0.035);
  if(t<0.42) return mix(a,b,t/0.42); if(t<0.75) return mix(b,c,(t-0.42)/0.33); return mix(c,d,(t-0.75)/0.25);
}
void main(){
  vec3 ray=normalize(vUv-vec3(0.5)); vec3 inv=1.0/ray;
  vec3 t0=(vec3(0.0)-vUv)*inv, t1=(vec3(1.0)-vUv)*inv;
  vec3 lo=min(t0,t1), hi=max(t0,t1); float en=max(max(lo.x,lo.y),lo.z), ex=min(min(hi.x,hi.y),hi.z);
  if(ex<=en) discard;
  vec3 p=vUv+ray*max(en,0.0); vec4 acc=vec4(0.0);
  for(int i=0;i<180;i++){
    if(any(lessThan(p,vec3(0.0)))||any(greaterThan(p,vec3(1.0)))) break;
    float depth=1.0-p.z;
    if(depth<=uCut){ float v=texture(uData,p).r; if(v>-0.001){
      float t=clamp((v-uRange.x)/max(0.000001,uRange.y-uRange.x),0.0,1.0);
      float a=0.032*uOpacity; vec3 col=cmap(t); acc.rgb+=(1.0-acc.a)*a*col; acc.a+=(1.0-acc.a)*a;
      if(acc.a>0.96) break;
    }} p += ray/140.0;
  }
  if(acc.a<0.004) discard; gl_FragColor=acc;
}`;

function OceanCanvas({ payload, variable, timeIndex, depth, view, opacity }) {
  const host = useRef(null);
  const state = useRef({});
  const meta = useMemo(() => describe(variable), [variable]);

  useEffect(() => {
    const el = host.current;
    if (!el || !payload) return undefined;
    while (el.firstChild) el.removeChild(el.firstChild);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04131c);
    scene.fog = new THREE.FogExp2(0x04131c, 0.0011);
    const camera = new THREE.PerspectiveCamera(46, el.clientWidth / el.clientHeight, 0.1, 6000);
    camera.position.set(520, -620, 470);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.06; controls.target.set(0, 0, -130);
    scene.add(new THREE.HemisphereLight(0x9edee8, 0x172229, 1.35));
    const sun = new THREE.DirectionalLight(0xe6fbff, 2.0); sun.position.set(-300, -400, 900); scene.add(sun);

    const root = new THREE.Group(); scene.add(root);
    const grid = new THREE.GridHelper(980, 18, 0x18475a, 0x10303d); grid.position.z = -360; grid.material.transparent = true; grid.material.opacity = 0.35; root.add(grid);

    let gridData;
    try { gridData = extractGrid(payload, timeIndex); } catch (e) { state.current.error = e.message; return undefined; }
    const { values, nx, ny, nz, min, max } = gridData;
    const texData = new Float32Array(values.length);
    for (let i = 0; i < values.length; i++) texData[i] = Number.isFinite(values[i]) && values[i] > -999 ? values[i] : -1;
    const texture = new THREE.Data3DTexture(texData, nx, ny, nz);
    texture.format = THREE.RedFormat; texture.type = THREE.FloatType; texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.unpackAlignment = 1; texture.needsUpdate = true;
    const box = new THREE.BoxGeometry(820, 480, Math.max(80, 560 * Math.min(1, nz / 32)));
    const material = new THREE.ShaderMaterial({ vertexShader: volumeVertex, fragmentShader: volumeFragment, uniforms: { uData: { value: texture }, uRange: { value: new THREE.Vector2(min, max) }, uCut: { value: depth }, uOpacity: { value: opacity } }, transparent: true, side: THREE.BackSide, depthWrite: false });
    const volume = new THREE.Mesh(box, material); root.add(volume);

    const surfaceGeo = new THREE.PlaneGeometry(820, 480, Math.min(nx - 1, 80), Math.min(ny - 1, 60));
    const pos = surfaceGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = Math.min(nx - 1, Math.floor((i % (Math.min(nx - 1, 80) + 1)) / Math.max(1, Math.min(nx - 1, 80)) * (nx - 1)));
      const y = Math.min(ny - 1, Math.floor(Math.floor(i / (Math.min(nx - 1, 80) + 1)) / Math.max(1, Math.min(ny - 1, 60)) * (ny - 1)));
      const v = values[y * nx + x]; const t = Number.isFinite(v) && v > -999 ? (v - min) / Math.max(max - min, 1e-6) : 0;
      c.setHSL(0.68 - 0.64 * Math.max(0, Math.min(1, t)), 0.84, 0.5); colors[i*3]=c.r; colors[i*3+1]=c.g; colors[i*3+2]=c.b;
    }
    surfaceGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const surface = new THREE.Mesh(surfaceGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    surface.rotation.x = -Math.PI / 2; surface.position.z = 0; root.add(surface);

    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0x24647a, transparent: true, opacity: 0.65 })); root.add(frame);
    state.current = { camera, controls, root, volume, material, texture, min, max, renderer, scene, frame, error: '' };

    const resize = () => { camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(el.clientWidth, el.clientHeight); };
    window.addEventListener('resize', resize);
    let raf = 0;
    const animate = () => { raf = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
    animate();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); controls.dispose(); box.dispose(); surfaceGeo.dispose(); texture.dispose(); material.dispose(); renderer.dispose(); };
  }, [payload, variable, timeIndex, opacity]);

  useEffect(() => {
    const s = state.current;
    if (!s.camera) return;
    const target = new THREE.Vector3(0, 0, -120);
    if (view === 'TOP') { s.camera.position.set(0, -20, 980); target.set(0,0,0); }
    if (view === 'PROFILE') { s.camera.position.set(0, -980, -80); target.set(0,0,-160); }
    if (view === 'UNDER') { s.camera.position.set(0, 40, -900); target.set(0,0,-160); }
    if (view === '3D') { s.camera.position.set(520,-620,470); target.set(0,0,-130); }
    s.controls.target.copy(target); s.controls.update();
  }, [view]);

  useEffect(() => { if (state.current.material) state.current.material.uniforms.uCut.value = depth; }, [depth]);
  return <div className="viewport" ref={host} />;
}

function App() {
  const [datasets, setDatasets] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [selected, setSelected] = useState(null);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [apiOk, setApiOk] = useState(false);
  const [depth, setDepth] = useState(1);
  const [opacity, setOpacity] = useState(1);
  const [view, setView] = useState('3D');
  const [timeIndex, setTimeIndex] = useState(0);
  const [times, setTimes] = useState([]);
  const [sidebar, setSidebar] = useState(true);

  const loadCatalog = async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`${API}/datasets`); if (!r.ok) throw new Error(`Datasets request failed (${r.status})`);
      const d = await r.json(); const ds = Array.isArray(d) ? d : d.datasets || [];
      setDatasets(ds); setApiOk(true);
      const rows = [];
      for (const item of ds) {
        const file = datasetFile(item); if (!file) continue;
        try {
          const vr = await fetch(`${API}/variables/${encodeURIComponent(file)}`); if (!vr.ok) continue;
          const list = variableList(await vr.json()); list.forEach(v => rows.push({ file, variable: v }));
        } catch (_) {}
      }
      const unique = Array.from(new Map(rows.map(x => [`${x.file}|${x.variable}`, x])).values());
      setCatalog(unique);
      if (!selected && unique.length) setSelected(unique.find(x => /temperature/i.test(x.variable)) || unique[0]);
    } catch (e) { setApiOk(false); setError(`Cannot connect to SolvX API at ${API}`); } finally { setLoading(false); }
  };

  useEffect(() => { loadCatalog(); }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true); setError(''); setPayload(null); setTimeIndex(0); setTimes([]);
    const q = new URLSearchParams({ file: selected.file, variable: selected.variable, ...Object.fromEntries(Object.entries(BOUNDS).map(([k,v]) => [k.replace('Min','_min').replace('Max','_max'), String(v)])), depth_min: '0', depth_max: '5000' });
    fetch(`${API}/data/region/array?${q}`).then(async r => { if (!r.ok) { const t = await r.text(); throw new Error(t || `Data request failed (${r.status})`); } return r.json(); }).then(p => { if (cancelled) return; setPayload(p); const tv = timeValues(p); setTimes(tv); }).catch(e => { if (!cancelled) setError(`Field load failed: ${e.message}`); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected]);

  const active = selected ? describe(selected.variable) : { name: 'Ocean data', unit: '—', icon: 'O' };
  const visibleCatalog = catalog;
  const currentTime = times[timeIndex] ?? 'Current field';
  const timeLabel = typeof currentTime === 'string' ? currentTime.replace('T', ' ').replace(/\.\d+$/, '') : String(currentTime);

  return <main>
    <header className="topbar">
      <div className="brand"><div className="logo">S</div><div><strong>SolvX</strong><small>OCEAN EXPLORER</small></div></div>
      <div className="study"><span>STUDY REGION</span><b>BAY OF BENGAL</b><small>16.07°N — 23.52°N · 84.10°E — 92.99°E</small></div>
      <div className="topActions"><span className={apiOk ? 'liveDot' : 'offlineDot'} />{apiOk ? 'API CONNECTED' : 'API OFFLINE'}<button onClick={loadCatalog}>↻</button></div>
    </header>

    {sidebar && <aside className="sidebar">
      <div className="sideTitle">OCEAN VARIABLES <span>{String(visibleCatalog.length).padStart(2,'0')}</span></div>
      <div className="activeCard"><div className="fieldIcon">{active.icon}</div><div><b>{active.name}</b><small>{selected?.variable || 'Select a variable'} · {active.unit}</small></div></div>
      <div className="variableList">{visibleCatalog.map(item => { const d=describe(item.variable); return <button key={`${item.file}|${item.variable}`} className={selected?.variable===item.variable && selected?.file===item.file ? 'selected' : ''} onClick={()=>setSelected(item)}><span className="miniIcon">{d.icon}</span><span>{d.name}</span><em>{d.unit}</em></button>; })}</div>
      <div className="divider" />
      <div className="sideTitle">VIEW MODE <span>02</span></div>
      <div className="viewGrid">{['3D','TOP','PROFILE','UNDER'].map(v=><button key={v} className={view===v?'active':''} onClick={()=>setView(v)}>{v}</button>)}</div>
      <div className="divider" />
      <div className="sideTitle">DEPTH <span>03</span></div>
      <div className="bigValue">{Math.round((1-depth)*5000)} <small>m</small></div>
      <input type="range" min="0" max="1" step="0.01" value={depth} onChange={e=>setDepth(Number(e.target.value))}/>
      <div className="rangeEnds"><span>Surface</span><span>5,000 m</span></div>
      <div className="divider" />
      <div className="sideTitle">DISPLAY</div>
      <label className="toggleRow">Field opacity <input type="range" min="0.2" max="1.5" step="0.05" value={opacity} onChange={e=>setOpacity(Number(e.target.value))}/></label>
      <div className="fileName">DATASET <b>{selected?.file || '—'}</b></div>
    </aside>}

    <div className="toolbar"><button onClick={()=>setSidebar(!sidebar)}>{sidebar?'HIDE PANEL':'SHOW PANEL'}</button><button onClick={()=>{setView('3D');setDepth(1)}}>RESET VIEW</button><button onClick={()=>document.documentElement.requestFullscreen?.()}>FULLSCREEN</button></div>
    <div className="status">{error || (loading ? 'LOADING OCEAN FIELD…' : `${active.name.toUpperCase()} · ${payload?.shape?.join(' × ') || '—'} GRID`)}</div>

    {payload && !error ? <OceanCanvas payload={payload} variable={selected?.variable} timeIndex={timeIndex} depth={depth} view={view} opacity={opacity}/> : <div className="empty"><div><div className="spinner"/><b>{loading ? 'CONNECTING TO OCEAN DATA' : 'NO FIELD LOADED'}</b><small>{error || 'Select an ocean variable to begin.'}</small></div></div>}

    <div className="legend"><div><b>{active.name}</b><span>{active.unit}</span></div><div className="gradient"/><div className="legendEnds"><span>LOW</span><span>FIELD VALUE</span><span>HIGH</span></div></div>

    <footer className="timeline"><div className="timeMeta"><span>TIME SERIES</span><b>{timeLabel}</b><small>{times.length ? `${timeIndex+1} / ${times.length}` : 'single field'}</small></div><input type="range" min="0" max={Math.max(0,times.length-1)} value={Math.min(timeIndex,Math.max(0,times.length-1))} onChange={e=>setTimeIndex(Number(e.target.value))} disabled={times.length<2}/><div className="timeEnds"><span>{times[0] ? String(times[0]).slice(0,10) : 'DATA'}</span><span>{times.at(-1) ? String(times.at(-1)).slice(0,10) : 'LIVE API'}</span></div></footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
