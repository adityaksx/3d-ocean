import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
const REGION = { lat_min: 16.07, lat_max: 23.52, lon_min: 84.10, lon_max: 92.99, depth_min: 0, depth_max: 1500 };

const VARIABLES = [
  { id: 'temperature', label: 'Temperature', unit: '°C', icon: 'T', match: /temperature|thetao/i },
  { id: 'sst-anomaly', label: 'SST anomaly', unit: '°C', icon: 'Δ', match: /anomaly|anom/i },
  { id: 'salinity', label: 'Salinity', unit: 'PSU', icon: 'S', match: /salinity|so/i },
  { id: 'currents', label: 'Currents', unit: 'm/s', icon: '→', match: /current|uo|vo/i },
  { id: 'sea-level', label: 'Sea level', unit: 'm', icon: '≈', match: /sea.?level|height|ssh|mass.?volume/i },
  { id: 'hazards', label: 'Abnormal / hazards', unit: 'warning', icon: '!', match: /cyclone|hazard|warning|disaster/i },
  { id: 'chlorophyll', label: 'Chlorophyll', unit: 'mg/m³', icon: 'C', match: /chlorophyll|chl/i }
];

const DEPTHS = [0, 10, 25, 50, 100, 200, 500, 1000, 1500];

function valueText(v) { return typeof v === 'string' ? v : (v?.name ?? v?.variable ?? v?.id ?? ''); }
function fileText(v) { return valueText(v?.filename ?? v?.file ?? v?.name ?? v?.path); }
function variablesFrom(x) {
  if (Array.isArray(x)) return x.map(valueText).filter(Boolean);
  if (Array.isArray(x?.variables)) return x.variables.map(valueText).filter(Boolean);
  if (x?.variables && typeof x.variables === 'object') return Object.keys(x.variables);
  return Object.keys(x || {});
}
function dimsOf(p) {
  const dimensions = (p?.dimensions || []).map(String);
  const shape = (p?.shape || []).map(Number);
  const find = (...keys) => dimensions.findIndex(d => keys.some(k => d.toLowerCase().includes(k)));
  return { dimensions, shape, xi: find('longitude', 'lon'), yi: find('latitude', 'lat'), zi: find('depth', 'lev', 'z'), ti: find('time', 'date') };
}
function nested(root, ids) { let x = root; for (const id of ids) { if (!Array.isArray(x)) return NaN; x = x[id]; } return Number(x); }
function extractGrid(p, timeIndex = 0) {
  const { dimensions, shape, xi, yi, zi, ti } = dimsOf(p);
  if (xi < 0 || yi < 0) throw Error('The API response has no latitude/longitude dimensions.');
  const nx = shape[xi], ny = shape[yi], nz = zi >= 0 ? shape[zi] : 1;
  const total = nx * ny * nz;
  if (!nx || !ny || total > 450000) throw Error(`Field is ${Number(total || 0).toLocaleString()} values; request a smaller region.`);
  const values = new Float32Array(total);
  let min = Infinity, max = -Infinity;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const ids = dimensions.map((_, d) => d === xi ? x : d === yi ? y : d === zi ? z : d === ti ? timeIndex : 0);
    const v = nested(p.data, ids);
    const i = z * nx * ny + y * nx + x;
    values[i] = Number.isFinite(v) ? v : NaN;
    if (Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
  }
  if (!Number.isFinite(min)) throw Error('The selected field contains no numeric values.');
  return { values, nx, ny, nz, min, max, timeCount: ti >= 0 ? shape[ti] : 1 };
}
function getVariableMeta(variable) {
  const hit = VARIABLES.find(v => v.match.test(variable || ''));
  return hit || { label: variable || 'Ocean field', unit: '—', icon: '•', id: 'field' };
}
function parseTimes(json) {
  const raw = json?.times ?? json?.dates ?? json?.time ?? json?.timestamps ?? json;
  if (!Array.isArray(raw)) return [];
  return raw.map(v => typeof v === 'string' ? v : (v?.value ?? v?.date ?? v?.time ?? v?.timestamp)).filter(Boolean).map(String);
}
function formatDate(value, compact = false) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  return d.toLocaleDateString('en-IN', compact ? { day: '2-digit', month: 'short' } : { day: '2-digit', month: 'short', year: 'numeric' });
}
function colorMap(variable, t, out = new THREE.Color()) {
  t = Math.max(0, Math.min(1, t));
  const meta = getVariableMeta(variable);
  if (meta.id === 'salinity') return out.setHSL(0.56 - 0.25 * t, 0.72, 0.48);
  if (meta.id === 'chlorophyll') return out.setHSL(0.28 - 0.14 * t, 0.70, 0.48);
  if (meta.id === 'sst-anomaly') return out.setHSL(0.60 - 0.60 * t, 0.78, 0.50);
  return out.setHSL(0.64 - 0.60 * t, 0.78, 0.50);
}

function OceanScene({ payload, variable, view, depthFraction, opacity, onStats, onPoint }) {
  const host = useRef(null);
  const state = useRef(null);
  const meta = getVariableMeta(variable);

  useEffect(() => {
    const el = host.current;
    if (!el || !payload) return;
    el.replaceChildren();

    let grid;
    try { grid = extractGrid(payload, 0); } catch (e) { onStats({ error: e.message }); return; }
    const { values, nx, ny, nz, min, max, timeCount } = grid;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f6f4);
    scene.fog = new THREE.FogExp2(0xf3f6f4, 0.0011);
    const camera = new THREE.PerspectiveCamera(44, Math.max(1, el.clientWidth) / Math.max(1, el.clientHeight), 0.1, 5000);
    camera.position.set(620, -690, 470);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.screenSpacePanning = true;
    controls.minDistance = 70;
    controls.maxDistance = 2400;
    controls.target.set(0, 0, -160);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xcbd6d0, 1.65));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-400, -500, 900);
    scene.add(sun);

    const root = new THREE.Group();
    scene.add(root);
    const width = 900;
    const height = 520;
    const depthSize = Math.max(110, Math.min(700, 110 + nz * 14));

    // Geological seabed: always visible beneath the water field.
    const seabed = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x8b6d4f, roughness: 0.96, metalness: 0, side: THREE.DoubleSide })
    );
    seabed.rotation.x = -Math.PI / 2;
    seabed.position.z = -depthSize;
    root.add(seabed);

    // Default water surface; selected fields are rendered inside the volume.
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height, 1, 1),
      new THREE.MeshPhysicalMaterial({ color: 0x287eaa, transparent: true, opacity: 0.22, roughness: 0.16, metalness: 0, depthWrite: false, side: THREE.DoubleSide })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.z = 1;
    root.add(water);

    const surfaceGeo = new THREE.PlaneGeometry(width, height, Math.min(90, Math.max(1, nx - 1)), Math.min(70, Math.max(1, ny - 1)));
    const sx = Math.min(90, Math.max(1, nx - 1));
    const sy = Math.min(70, Math.max(1, ny - 1));
    const colors = new Float32Array(surfaceGeo.attributes.position.count * 3);
    const c = new THREE.Color();
    for (let y = 0; y <= sy; y++) for (let x = 0; x <= sx; x++) {
      const ix = Math.min(nx - 1, Math.round(x / sx * (nx - 1)));
      const iy = Math.min(ny - 1, Math.round(y / sy * (ny - 1)));
      const v = values[iy * nx + ix];
      const t = Number.isFinite(v) ? (v - min) / Math.max(max - min, 1e-9) : 0;
      colorMap(variable, t, c);
      const i = y * (sx + 1) + x;
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    surfaceGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const fieldSurface = new THREE.Mesh(surfaceGeo, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.60, roughness: 0.48, side: THREE.DoubleSide }));
    fieldSurface.rotation.x = -Math.PI / 2;
    fieldSurface.position.z = 3;
    root.add(fieldSurface);

    const box = new THREE.BoxGeometry(width, height, depthSize);
    let volume = null, texture = null, material = null;
    if (nz > 1 && renderer.capabilities.isWebGL2) {
      const texData = new Float32Array(values.length);
      for (let i = 0; i < values.length; i++) texData[i] = Number.isFinite(values[i]) ? values[i] : -9999;
      texture = new THREE.Data3DTexture(texData, nx, ny, nz);
      texture.format = THREE.RedFormat;
      texture.type = THREE.FloatType;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.unpackAlignment = 1;
      texture.needsUpdate = true;
      const vs = 'varying vec3 vUv; void main(){vUv=position*.5+.5;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
      const fs = `precision highp float;precision highp sampler3D;varying vec3 vUv;uniform sampler3D uData;uniform vec2 uRange;uniform float uCut;uniform float uOpacity;vec3 cmap(float t){vec3 a=vec3(.03,.12,.58),b=vec3(.02,.63,.86),c=vec3(.98,.86,.16),d=vec3(.90,.10,.03);if(t<.42)return mix(a,b,t/.42);if(t<.75)return mix(b,c,(t-.42)/.33);return mix(c,d,(t-.75)/.25);}void main(){vec3 ray=normalize(vUv-.5),inv=1./ray,t0=(vec3(0.)-vUv)*inv,t1=(vec3(1.)-vUv)*inv,lo=min(t0,t1),hi=max(t0,t1);float en=max(max(lo.x,lo.y),lo.z),ex=min(min(hi.x,hi.y),hi.z);if(ex<=en)discard;vec3 p=vUv+ray*max(en,0.);vec4 o=vec4(0.);for(int i=0;i<180;i++){if(any(lessThan(p,vec3(0.)))||any(greaterThan(p,vec3(1.))))break;float d=1.-p.z;if(d<=uCut){float v=texture(uData,p).r;if(v>-9000.){float t=clamp((v-uRange.x)/max(.000001,uRange.y-uRange.x),0.,1.);float al=.030*uOpacity;vec3 col=cmap(t);o.rgb+=(1.-o.a)*al*col;o.a+=(1.-o.a)*al;if(o.a>.94)break;}}p+=ray/150.;}if(o.a<.003)discard;gl_FragColor=o;}`;
      material = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: { uData: { value: texture }, uRange: { value: new THREE.Vector2(min, max) }, uCut: { value: depthFraction }, uOpacity: { value: opacity } }, transparent: true, side: THREE.BackSide, depthWrite: false });
      volume = new THREE.Mesh(box, material);
      volume.position.z = -depthSize / 2;
      root.add(volume);
    }

    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depthSize)), new THREE.LineBasicMaterial({ color: 0x91a6a0, transparent: true, opacity: 0.55 }));
    outline.position.z = -depthSize / 2;
    root.add(outline);

    // Transparent pick plane. It maps the click into the study region.
    const pickPlane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    pickPlane.rotation.x = -Math.PI / 2;
    pickPlane.position.z = 4;
    root.add(pickPlane);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handleClick = event => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(pickPlane, false)[0];
      if (!hit) return;
      const lat = REGION.lat_min + ((hit.point.y + height / 2) / height) * (REGION.lat_max - REGION.lat_min);
      const lon = REGION.lon_min + ((hit.point.x + width / 2) / width) * (REGION.lon_max - REGION.lon_min);
      onPoint?.({ latitude: lat, longitude: lon });
    };
    renderer.domElement.addEventListener('click', handleClick);

    state.current = { camera, controls, renderer, material, texture, box, depthSize, timeCount };
    onStats({ min, max, nx, ny, nz, timeCount, webgl2: renderer.capabilities.isWebGL2 });

    const resize = () => { camera.aspect = Math.max(1, el.clientWidth) / Math.max(1, el.clientHeight); camera.updateProjectionMatrix(); renderer.setSize(el.clientWidth, el.clientHeight); };
    window.addEventListener('resize', resize);
    let raf = 0;
    const animate = () => { raf = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
    animate();
    return () => {
      cancelAnimationFrame(raf); window.removeEventListener('resize', resize); renderer.domElement.removeEventListener('click', handleClick); controls.dispose(); renderer.dispose();
      surfaceGeo.dispose(); box.dispose(); seabed.geometry.dispose(); water.geometry.dispose(); if (texture) texture.dispose(); if (material) material.dispose();
    };
  }, [payload, variable, opacity, depthFraction, onPoint, onStats]);

  useEffect(() => {
    const s = state.current;
    if (!s?.camera) return;
    const target = new THREE.Vector3(0, 0, -s.depthSize / 2);
    if (view === 'TOP') { s.camera.position.set(0, 0, 1120); target.set(0, 0, 0); }
    else if (view === 'PROFILE') s.camera.position.set(0, -1120, -s.depthSize * 0.52);
    else if (view === 'UNDER') s.camera.position.set(0, 0, -1120);
    else s.camera.position.set(620, -690, 470);
    s.controls.target.copy(target); s.controls.update();
  }, [view]);

  useEffect(() => { if (state.current?.material) { state.current.material.uniforms.uCut.value = depthFraction; state.current.material.uniforms.uOpacity.value = opacity; } }, [depthFraction, opacity]);
  return <div ref={host} className="ocean-canvas" aria-label={`${meta.label} 3D ocean visualization`} />;
}

export default function App() {
  const [catalog, setCatalog] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [payload, setPayload] = useState(null);
  const [times, setTimes] = useState([]);
  const [timeIndex, setTimeIndex] = useState(0);
  const [depthIndex, setDepthIndex] = useState(0);
  const [view, setView] = useState('3D');
  const [opacity, setOpacity] = useState(0.88);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(false);
  const [filter, setFilter] = useState('');
  const [mobilePanel, setMobilePanel] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [point, setPoint] = useState(null);
  const [pointLoading, setPointLoading] = useState(false);
  const [stats, setStats] = useState(null);

  const meta = useMemo(() => getVariableMeta(selected?.variable), [selected]);
  const visible = useMemo(() => catalog.filter(x => !filter || x.label.toLowerCase().includes(filter.toLowerCase())), [catalog, filter]);
  const depth = DEPTHS[Math.min(depthIndex, DEPTHS.length - 1)];
  const depthFraction = Math.max(0.01, Math.min(1, depth / REGION.depth_max || 0.01));
  const date = times[timeIndex];

  const loadCatalog = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`${API}/datasets`);
      if (!r.ok) throw Error(`API returned ${r.status}`);
      const data = await r.json();
      const ds = Array.isArray(data) ? data : (data.datasets || []);
      setDatasets(ds);
      const rows = [];
      for (const d of ds) {
        const file = fileText(d);
        if (!file) continue;
        try {
          const vr = await fetch(`${API}/variables/${encodeURIComponent(file)}`);
          if (!vr.ok) continue;
          for (const variable of variablesFrom(await vr.json())) rows.push({ file, variable });
        } catch {}
      }
      const unique = [...new Map(rows.map(x => [`${x.file}|${x.variable}`, x])).values()];
      const supported = VARIABLES.map(v => {
        const found = unique.find(x => v.match.test(x.variable));
        return found ? { ...found, id: v.id, label: v.label, unit: v.unit, icon: v.icon, available: true } : { file: null, variable: v.label, id: v.id, label: v.label, unit: v.unit, icon: v.icon, available: false };
      });
      setCatalog(supported);
      setSelected(s => s || supported.find(x => x.available && x.id === 'temperature') || supported.find(x => x.available) || null);
      setOnline(true);
    } catch (e) {
      setOnline(false); setError(`Cannot connect to SolvX API at ${API}`);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  useEffect(() => {
    fetch(`${API}/ocean/time`).then(r => r.ok ? r.json() : Promise.reject()).then(j => { const t = parseTimes(j); if (t.length) setTimes(t); }).catch(() => {});
  }, []);

  const loadField = useCallback(async (item, requestedTimeIndex = 0) => {
    if (!item?.file) { setPayload(null); return; }
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ file: item.file, variable: item.variable, ...Object.fromEntries(Object.entries(REGION).map(([k, v]) => [k, String(v)])) });
      const t = times[requestedTimeIndex];
      if (t) { params.set('time_start', t); params.set('time_end', t); }
      const r = await fetch(`${API}/data/region/array?${params}`);
      if (!r.ok) {
        let detail = '';
        try { detail = (await r.json())?.detail?.error || ''; } catch {}
        throw Error(detail || `Field request failed (${r.status})`);
      }
      const json = await r.json();
      setPayload(json);
      if (!times.length) {
        try { const inferred = extractGrid(json).timeCount; if (inferred > 1) setTimes(Array.from({ length: inferred }, (_, i) => `Step ${i + 1}`)); } catch {}
      }
    } catch (e) { setPayload(null); setError(e.message); }
    finally { setLoading(false); }
  }, [times]);

  useEffect(() => { if (selected?.available) loadField(selected, timeIndex); }, [selected]);

  useEffect(() => {
    if (!playing || times.length < 2) return;
    const id = window.setInterval(() => setTimeIndex(i => (i + 1) % times.length), 1200);
    return () => window.clearInterval(id);
  }, [playing, times.length]);

  useEffect(() => { if (selected?.available && times[timeIndex]) loadField(selected, timeIndex); }, [timeIndex]);

  const choose = item => { if (!item.available) return; setSelected(item); setTimeIndex(0); setPoint(null); setMobilePanel(false); };
  const resetCamera = () => setView('3D');
  const inspectPoint = async ({ latitude, longitude }) => {
    setPointLoading(true); setPoint({ latitude, longitude });
    try {
      const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), ...(date && !String(date).startsWith('Step') ? { time: date } : {}) });
      const r = await fetch(`${API}/ocean/point?${params}`);
      if (!r.ok) throw Error();
      const data = await r.json();
      setPoint({ latitude, longitude, data });
    } catch { setPoint(p => ({ ...p, error: 'Point data unavailable for this timestamp.' })); }
    finally { setPointLoading(false); }
  };

  return <main className="app">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">S</div><div><strong>SOLVX</strong><span>INTERACTIVE OCEAN INTELLIGENCE</span></div></div>
      <div className="study"><span>STUDY AREA</span><b>Bay of Bengal</b><small>16.07°–23.52°N · 84.10°–92.99°E</small></div>
      <div className="top-actions"><span className={online ? 'live' : 'offline'}><i />{online ? 'LIVE DATA' : 'OFFLINE'}</span><button onClick={() => setMobilePanel(v => !v)} className="panel-toggle">{mobilePanel ? 'Close' : 'Controls'}</button><button onClick={resetCamera} className="reset">Reset view</button></div>
    </header>

    <aside className={`control-panel ${mobilePanel ? 'open' : ''}`}>
      <div className="panel-scroll">
        <div className="panel-kicker">OCEAN VARIABLES <span>{catalog.filter(x => x.available).length}/7</span></div>
        <div className="active-card"><div className="active-icon">{meta.icon}</div><div><span>ACTIVE FIELD</span><b>{meta.label}</b><small>{selected?.variable || 'Select a variable'}</small></div></div>
        <label className="search-wrap"><span>⌕</span><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search variables" /></label>
        <div className="variable-list">
          {visible.map(item => <button key={item.id} className={`variable ${selected?.id === item.id ? 'selected' : ''} ${!item.available ? 'disabled' : ''}`} onClick={() => choose(item)}><span className="var-icon">{item.icon}</span><span className="var-copy"><b>{item.label}</b><small>{item.unit}{item.available ? '' : ' · no matching dataset'}</small></span><span className="var-state">{selected?.id === item.id ? 'ON' : item.available ? '' : '—'}</span></button>)}
        </div>

        <div className="panel-section"><div className="section-title">DEPTH LAYER <strong>{depth === 0 ? 'SURFACE' : `${depth} m`}</strong></div><input className="depth-range" type="range" min="0" max={DEPTHS.length - 1} step="1" value={depthIndex} onChange={e => setDepthIndex(+e.target.value)} /><div className="depth-labels"><span>Surface</span><span>1.5 km</span></div><div className="depth-chips">{DEPTHS.map((d, i) => <button key={d} className={i === depthIndex ? 'active' : ''} onClick={() => setDepthIndex(i)}>{d === 0 ? 'SURF' : `${d}m`}</button>)}</div></div>

        <div className="panel-section"><div className="section-title">VIEW <strong>{view}</strong></div><div className="view-grid">{[['3D','VOLUME'],['TOP','SURFACE'],['PROFILE','PROFILE'],['UNDER','UNDER']].map(([id,label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><span>{id === '3D' ? '◈' : id === 'TOP' ? '□' : id === 'PROFILE' ? '▤' : '◇'}</span>{label}</button>)}</div></div>

        <div className="panel-section"><div className="section-title">FIELD DISPLAY <strong>{Math.round(opacity * 100)}%</strong></div><input type="range" min="0.35" max="1" step="0.01" value={opacity} onChange={e => setOpacity(+e.target.value)} /></div>
        <div className="dataset-foot"><span>DATA SOURCES</span><b>{datasets.length || '—'} datasets connected</b><small>NetCDF · xarray · SolvX API</small></div>
      </div>
    </aside>

    <section className="scene-title"><span>3D OCEAN EXPLORER</span><h1>{meta.label}</h1><p>{date && !String(date).startsWith('Step') ? formatDate(date) : 'Select a date on the timeline'} <i /> {depth === 0 ? 'Surface' : `${depth} m layer`}</p></section>

    {payload && !error ? <OceanScene payload={payload} variable={selected?.variable} view={view} depthFraction={depthFraction} opacity={opacity} onStats={setStats} onPoint={inspectPoint} /> : <div className="empty-state"><div className="empty-card">{loading ? <div className="spinner" /> : <div className="empty-mark">!</div>}<b>{error ? 'FIELD UNAVAILABLE' : 'LOADING OCEAN FIELD'}</b><p>{error || 'Preparing the selected NetCDF field…'}</p>{error && <button onClick={() => loadField(selected, timeIndex)}>Retry</button>}</div></div>}

    <div className="top-status"><span>{stats?.nx ? `${stats.nx} × ${stats.ny} × ${stats.nz}` : '—'} grid</span><i /> <span>{online ? 'API connected' : 'API offline'}</span></div>

    <div className="legend-card">
      <div className="legend-head"><div><span>COLOR SCALE</span><b>{meta.label}</b></div><strong>{meta.unit}</strong></div>
      <div className={`legend-bar ${meta.id}`} />
      <div className="legend-values"><span>{stats?.min != null ? stats.min.toFixed(2) : 'LOW'}</span><span>{stats?.max != null ? stats.max.toFixed(2) : 'HIGH'}</span></div>
      <small>{meta.id === 'currents' ? 'Direction shown with flow vectors' : 'Values update with time and depth'}</small>
    </div>

    {point && <aside className="point-card"><button className="point-close" onClick={() => setPoint(null)}>×</button><span className="point-kicker">POINT INSPECTION</span><h2>{point.latitude.toFixed(2)}°N <small>{point.longitude.toFixed(2)}°E</small></h2><div className="point-date">{date && !String(date).startsWith('Step') ? formatDate(date) : 'Current frame'} · {depth === 0 ? 'surface' : `${depth} m`}</div>{pointLoading ? <div className="point-loading">Reading all available variables…</div> : point.error ? <div className="point-error">{point.error}</div> : <div className="point-values">{VARIABLES.map(v => { const raw = point.data?.[v.id] ?? point.data?.[v.label] ?? point.data?.[v.label.toLowerCase()] ?? point.data?.[v.variable]; const value = typeof raw === 'object' ? raw?.value ?? raw?.data : raw; return <div key={v.id}><span><i>{v.icon}</i>{v.label}</span><b>{value == null || value === '' ? '—' : typeof value === 'number' ? value.toFixed(2) : String(value)}<small>{v.unit}</small></b></div>; })}</div>}</aside>}

    <footer className="timeline">
      <div className="time-side"><span>TIME</span><b>{date && !String(date).startsWith('Step') ? formatDate(date) : `Frame ${timeIndex + 1}`}</b><small>{times.length ? `${timeIndex + 1} / ${times.length}` : 'adaptive timeline'}</small></div>
      <button className="play" onClick={() => setPlaying(v => !v)} disabled={times.length < 2}>{playing ? 'Ⅱ' : '▶'}</button>
      <div className="timeline-track"><input type="range" min="0" max={Math.max(0, times.length - 1)} step="1" value={Math.min(timeIndex, Math.max(0, times.length - 1))} onChange={e => setTimeIndex(+e.target.value)} disabled={times.length < 2} /><div className="ticks">{times.length ? [0, Math.floor((times.length - 1) * .25), Math.floor((times.length - 1) * .5), Math.floor((times.length - 1) * .75), times.length - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => <span key={i} style={{ left: `${times.length === 1 ? 0 : i / (Math.max(1, times.length - 1)) * 100}%` }}>{formatDate(times[i], true)}</span>) : <span>Time coordinate</span>}</div></div>
    </footer>
  </main>;
}
