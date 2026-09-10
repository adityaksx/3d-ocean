import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
const REGION = { lat_min: 16.07, lat_max: 23.52, lon_min: 84.10, lon_max: 92.99, depth_min: 0, depth_max: 1500 };

const TYPES = [
  ['temperature', 'Temperature', '°C', 'T'], ['salinity', 'Salinity', 'PSU', 'S'],
  ['current', 'Currents', 'm/s', 'C'], ['sea level', 'Sea Surface Height', 'm', 'SSH'],
  ['sea surface temp', 'Sea Surface Temperature', '°C', 'SST'], ['anom', 'SST Anomaly', '°C', 'A'],
  ['chlor', 'Chlorophyll-a', 'mg/m³', 'CH'], ['oxygen', 'Dissolved Oxygen', 'mmol/m³', 'O₂'],
  ['ph', 'pH / Acidity', 'pH', 'pH'], ['wave', 'Wave Height', 'm', 'W'],
  ['wind', 'Wind', 'm/s', 'WD'], ['baymetry', 'Bathymetry', 'm', 'B']
];

function text(v) { return typeof v === 'string' ? v : (v?.name ?? v?.variable ?? v?.id ?? ''); }
function fileOf(v) { return text(v?.filename ?? v?.file ?? v?.name ?? v?.path); }
function describe(v) {
  const s = text(v) || 'Ocean Field'; const l = s.toLowerCase();
  const hit = TYPES.find(([k]) => l.includes(k));
  return hit ? { name: hit[1], unit: hit[2], icon: hit[3] } : { name: s.replaceAll('_', ' '), unit: '—', icon: '•' };
}
function varsOf(x) {
  if (Array.isArray(x)) return x.map(text).filter(Boolean);
  if (Array.isArray(x?.variables)) return x.variables.map(text).filter(Boolean);
  if (x?.variables && typeof x.variables === 'object') return Object.keys(x.variables);
  return Object.keys(x || {});
}
function dimsOf(p) {
  const dims = (p?.dimensions || []).map(String), shape = (p?.shape || []).map(Number);
  const idx = (...keys) => dims.findIndex(d => keys.some(k => d.toLowerCase().includes(k)));
  return { dims, shape, xi: idx('longitude','lon'), yi: idx('latitude','lat'), zi: idx('depth','lev','z'), ti: idx('time','date') };
}
function nested(root, ids) { let x = root; for (const i of ids) { if (!Array.isArray(x)) return NaN; x = x[i]; } return Number(x); }
function gridFrom(p, ti = 0) {
  const { dims, shape, xi, yi, zi, ti: timeDim } = dimsOf(p);
  if (xi < 0 || yi < 0) throw new Error('The API response has no latitude/longitude dimensions.');
  const nx = shape[xi], ny = shape[yi], nz = zi >= 0 ? shape[zi] : 1;
  const total = nx * ny * nz;
  if (!nx || !ny || total > 450000) throw new Error(`Field is ${total.toLocaleString()} values; reduce the requested region/depth.`);
  const values = new Float32Array(total); let min = Infinity, max = -Infinity;
  for (let z=0; z<nz; z++) for (let y=0; y<ny; y++) for (let x=0; x<nx; x++) {
    const ids = dims.map((_,d) => d===xi?x:d===yi?y:d===zi?z:d===timeDim?ti:0);
    const v = nested(p.data, ids); const i=z*nx*ny+y*nx+x;
    values[i] = Number.isFinite(v) ? v : NaN;
    if (Number.isFinite(v)) { min=Math.min(min,v); max=Math.max(max,v); }
  }
  if (!Number.isFinite(min)) throw new Error('The selected field contains no numeric values.');
  return { values,nx,ny,nz,min,max,timeCount:timeDim>=0?shape[timeDim]:1 };
}

function colorFor(t, c=new THREE.Color()) { return c.setHSL(0.68 - 0.64*Math.max(0,Math.min(1,t)), 0.86, 0.50); }

function OceanScene({ payload, variable, view, depth, opacity, onStats }) {
  const host=useRef(null); const sceneState=useRef(null);
  const meta=useMemo(()=>describe(variable),[variable]);
  useEffect(()=>{
    const el=host.current; if(!el || !payload) return;
    el.replaceChildren();
    const scene=new THREE.Scene(); scene.background=new THREE.Color(0x03131d); scene.fog=new THREE.FogExp2(0x03131d,0.00125);
    const camera=new THREE.PerspectiveCamera(44,Math.max(1,el.clientWidth)/Math.max(1,el.clientHeight),0.1,5000); camera.position.set(560,-640,430);
    const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'}); renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.setSize(el.clientWidth,el.clientHeight); renderer.outputColorSpace=THREE.SRGBColorSpace; el.appendChild(renderer.domElement);
    const controls=new OrbitControls(camera,renderer.domElement); controls.enableDamping=true; controls.dampingFactor=.055; controls.minDistance=80; controls.maxDistance=2200; controls.target.set(0,0,-150);
    scene.add(new THREE.HemisphereLight(0x9de5ef,0x07141b,1.45)); const sun=new THREE.DirectionalLight(0xffffff,2.0); sun.position.set(-300,-500,900); scene.add(sun);
    const root=new THREE.Group(); scene.add(root);
    let g;
    try { g=gridFrom(payload,0); } catch(e) { onStats({error:e.message}); return; }
    const {values,nx,ny,nz,min,max}=g;
    const width=860,height=510,depthSize=Math.max(90,Math.min(650,80+nz*13));

    const grid=new THREE.GridHelper(980,20,0x1a5668,0x0d3441); grid.position.z=-depthSize/2-25; grid.material.transparent=true; grid.material.opacity=.38; root.add(grid);

    const surfaceGeo=new THREE.PlaneGeometry(width,height,Math.min(90,nx-1),Math.min(70,ny-1));
    const segX=Math.min(90,nx-1), segY=Math.min(70,ny-1), col=new Float32Array(surfaceGeo.attributes.position.count*3), c=new THREE.Color();
    for(let y=0;y<=segY;y++) for(let x=0;x<=segX;x++) {
      const ix=Math.min(nx-1,Math.round(x/segX*(nx-1))), iy=Math.min(ny-1,Math.round(y/segY*(ny-1))); const v=values[iy*nx+ix];
      const t=Number.isFinite(v)?(v-min)/Math.max(max-min,1e-9):0; colorFor(t,c); const i=y*(segX+1)+x; col[i*3]=c.r; col[i*3+1]=c.g; col[i*3+2]=c.b;
    }
    surfaceGeo.setAttribute('color',new THREE.BufferAttribute(col,3)); const surface=new THREE.Mesh(surfaceGeo,new THREE.MeshStandardMaterial({vertexColors:true,transparent:true,opacity:.72,roughness:.48,metalness:.08,side:THREE.DoubleSide})); surface.rotation.x=-Math.PI/2; root.add(surface);

    const volumeData=new Float32Array(values.length); for(let i=0;i<values.length;i++) volumeData[i]=Number.isFinite(values[i])?values[i]:-9999;
    let volume=null, texture=null, material=null, box=null;
    if(nz>1 && renderer.capabilities.isWebGL2){
      texture=new THREE.Data3DTexture(volumeData,nx,ny,nz); texture.format=THREE.RedFormat; texture.type=THREE.FloatType; texture.minFilter=THREE.LinearFilter; texture.magFilter=THREE.LinearFilter; texture.unpackAlignment=1; texture.needsUpdate=true;
      const vs=`varying vec3 vUv; void main(){vUv=position*.5+.5;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
      const fs=`precision highp float; precision highp sampler3D; varying vec3 vUv; uniform sampler3D uData; uniform vec2 uRange; uniform float uCut; uniform float uOpacity; vec3 cm(float t){vec3 a=vec3(.02,.07,.48),b=vec3(.02,.62,.9),c=vec3(.98,.86,.18),d=vec3(.9,.05,.03);if(t<.42)return mix(a,b,t/.42);if(t<.75)return mix(b,c,(t-.42)/.33);return mix(c,d,(t-.75)/.25);} void main(){vec3 ray=normalize(vUv-vec3(.5));vec3 inv=1./ray;vec3 t0=(vec3(0.)-vUv)*inv,t1=(vec3(1.)-vUv)*inv,lo=min(t0,t1),hi=max(t0,t1);float en=max(max(lo.x,lo.y),lo.z),ex=min(min(hi.x,hi.y),hi.z);if(ex<=en)discard;vec3 p=vUv+ray*max(en,0.);vec4 a=vec4(0.);for(int i=0;i<180;i++){if(any(lessThan(p,vec3(0.)))||any(greaterThan(p,vec3(1.))))break;float dep=1.-p.z;if(dep<=uCut){float v=texture(uData,p).r;if(v>-9000.){float t=clamp((v-uRange.x)/max(.000001,uRange.y-uRange.x),0.,1.);float al=.028*uOpacity;a.rgb+=(1.-a.a)*al*cm(t);a.a+=(1.-a.a)*al;if(a.a>.95)break;}}p+=ray/150.;}if(a.a<.003)discard;gl_FragColor=a;}`;
      box=new THREE.BoxGeometry(width,height,depthSize); material=new THREE.ShaderMaterial({vertexShader:vs,fragmentShader:fs,uniforms:{uData:{value:texture},uRange:{value:new THREE.Vector2(min,max)},uCut:{value:depth},uOpacity:{value:opacity}},transparent:true,side:THREE.BackSide,depthWrite:false}); volume=new THREE.Mesh(box,material); volume.position.z=-depthSize/2; root.add(volume);
    }
    const frame=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(width,height,depthSize)),new THREE.LineBasicMaterial({color:0x287087,transparent:true,opacity:.65})); frame.position.z=-depthSize/2; root.add(frame);
    const seabed=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshStandardMaterial({color:0x765c42,roughness:.95,metalness:0,side:THREE.DoubleSide})); seabed.rotation.x=-Math.PI/2; seabed.position.z=-depthSize; seabed.scale.set(1,1,.01); root.add(seabed);
    sceneState.current={camera,controls,renderer,root,material,texture,volume,seabed,depthSize}; onStats({min,max,nx,ny,nz,webgl2:renderer.capabilities.isWebGL2});
    const resize=()=>{camera.aspect=Math.max(1,el.clientWidth)/Math.max(1,el.clientHeight);camera.updateProjectionMatrix();renderer.setSize(el.clientWidth,el.clientHeight)}; window.addEventListener('resize',resize);
    let raf=0; const animate=()=>{raf=requestAnimationFrame(animate);controls.update();renderer.render(scene,camera)}; animate();
    return()=>{cancelAnimationFrame(raf);window.removeEventListener('resize',resize);controls.dispose();renderer.dispose();surfaceGeo.dispose();if(texture)texture.dispose();if(material)material.dispose();if(box)box.dispose();};
  },[payload,variable,onStats,opacity]);
  useEffect(()=>{const s=sceneState.current;if(!s?.camera)return;const t=new THREE.Vector3(0,0,-s.depthSize/2);if(view==='TOP'){s.camera.position.set(0,0,1050);t.set(0,0,0)}else if(view==='PROFILE'){s.camera.position.set(0,-1050,-s.depthSize*.55);t.set(0,0,-s.depthSize*.55)}else if(view==='UNDER'){s.camera.position.set(0,0,-1050);t.set(0,0,-s.depthSize*.6)}else{s.camera.position.set(560,-640,430)}s.controls.target.copy(t);s.controls.update()},[view]);
  useEffect(()=>{const m=sceneState.current?.material;if(m)m.uniforms.uCut.value=Math.max(.02,Math.min(1,depth))},[depth]);
  return <div ref={host} className="ocean-canvas" aria-label={`${meta.name} 3D visualization`}/>;
}

export default function App(){
  const [datasets,setDatasets]=useState([]),[catalog,setCatalog]=useState([]),[selected,setSelected]=useState(null),[payload,setPayload]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[apiOk,setApiOk]=useState(false),[view,setView]=useState('3D'),[depth,setDepth]=useState(1),[opacity,setOpacity]=useState(.95),[sidebar,setSidebar]=useState(true),[stats,setStats]=useState(null),[timeIndex,setTimeIndex]=useState(0);
  const [filter,setFilter]=useState('');
  const meta=useMemo(()=>describe(selected?.variable),[selected]);
  const visible=useMemo(()=>catalog.filter(x=>!filter||meta.name.toLowerCase().includes(filter.toLowerCase())||x.variable.toLowerCase().includes(filter.toLowerCase())||x.file.toLowerCase().includes(filter.toLowerCase())),[catalog,filter,meta.name]);
  const loadCatalog=useCallback(async()=>{setLoading(true);setError('');try{const r=await fetch(`${API}/datasets`);if(!r.ok)throw Error(`API returned ${r.status}`);const j=await r.json();const ds=Array.isArray(j)?j:(j.datasets||[]);setDatasets(ds);const rows=[];for(const d of ds){const file=fileOf(d);if(!file)continue;try{const vr=await fetch(`${API}/variables/${encodeURIComponent(file)}`);if(!vr.ok)continue;for(const v of varsOf(await vr.json()))rows.push({file,variable:v})}catch{}}const unique=[...new Map(rows.map(x=>[`${x.file}|${x.variable}`,x])).values()];setCatalog(unique);setApiOk(true);setSelected(s=>s&&unique.some(x=>x.file===s.file&&x.variable===s.variable)?s:(unique.find(x=>/temperature/i.test(x.variable))||unique[0]||null));}catch(e){setApiOk(false);setError(`Cannot connect to SolvX API at ${API}`)}finally{setLoading(false)}},[]);
  useEffect(()=>{loadCatalog()},[loadCatalog]);
  useEffect(()=>{if(!selected)return;let cancelled=false;setLoading(true);setError('');const q=new URLSearchParams({file:selected.file,variable:selected.variable,...Object.fromEntries(Object.entries(REGION).map(([k,v])=>[k,String(v)]))});fetch(`${API}/data/region/array?${q}`).then(r=>{if(!r.ok)throw Error(`Field request failed (${r.status})`);return r.json()}).then(j=>{if(cancelled)return;setPayload(j);setTimeIndex(0)}).catch(e=>{if(!cancelled){setPayload(null);setError(e.message)}}).finally(()=>{if(!cancelled)setLoading(false)});return()=>{cancelled=true}},[selected]);
  const choose=x=>{setSelected(x);setView('3D');setError('')};
  return <main className="app">
    <header className="topbar"><div className="brand"><div className="brand-mark">S</div><div><strong>SolvX</strong><span>OCEAN EXPLORER · BAY OF BENGAL</span></div></div><div className="region">STUDY REGION <b>Bay of Bengal</b><span>16.07°N — 23.52°N · 84.10°E — 92.99°E</span></div><div className="top-actions"><span className={apiOk?'online':'offline'}><i/> {apiOk?'LIVE DATA':'OFFLINE'}</span><button onClick={()=>setSidebar(v=>!v)}>{sidebar?'Hide':'Show'} panel</button></div></header>
    {sidebar&&<aside className="panel"><div className="section-head"><span>OCEAN VARIABLES</span><em>{catalog.length.toString().padStart(2,'0')}</em></div><input className="search" placeholder="Search variable…" value={filter} onChange={e=>setFilter(e.target.value)}/><div className="var-list">{visible.map((x,i)=>{const m=describe(x.variable);return <button key={`${x.file}:${x.variable}:${i}`} className={selected?.file===x.file&&selected?.variable===x.variable?'selected':''} onClick={()=>choose(x)}><span className="vicon">{m.icon}</span><span className="vtext"><b>{m.name}</b><small>{x.variable} · {x.file}</small></span><small>{m.unit}</small></button>})}</div><div className="divider"/><div className="section-head"><span>VIEW MODE</span><em>02</em></div><div className="mode-grid">{['3D','TOP','PROFILE','UNDER'].map(v=><button key={v} className={view===v?'active':''} onClick={()=>setView(v)}>{v}</button>)}</div><div className="divider"/><div className="control-title"><span>DEPTH CLIP</span><b>{Math.round(depth*100)}%</b></div><input type="range" min=".02" max="1" step=".01" value={depth} onChange={e=>setDepth(+e.target.value)}/><div className="range"><span>Surface</span><span>Deep</span></div><div className="control-title"><span>FIELD OPACITY</span><b>{Math.round(opacity*100)}%</b></div><input type="range" min=".2" max="1" step=".01" value={opacity} onChange={e=>setOpacity(+e.target.value)}/><div className="divider"/><div className="dataset-box"><span>ACTIVE DATASET</span><b>{selected?.file||'—'}</b><small>{datasets.length} dataset(s) available through API</small></div></aside>}
    <section className="hud"><div className="eyebrow">REAL-TIME NETCDF FIELD</div><h1>{meta.name}</h1><div className="readout"><span className="dot"/> {stats?.nx?`${stats.nx} × ${stats.ny} × ${stats.nz} grid`:'Waiting for field'} <span>·</span> {stats?.min!=null?`${stats.min.toFixed(2)} — ${stats.max.toFixed(2)} ${meta.unit}`:'—'}</div></section>
    <div className="status">{error|| (loading?'Loading scientific field…':`${selected?.variable||'No variable selected'} · API ${apiOk?'connected':'offline'}`)}</div>
    {payload&&!error?<OceanScene payload={payload} variable={selected?.variable} view={view} depth={depth} opacity={opacity} onStats={setStats}/>:<div className="empty"><div><div className="spinner"/><b>{loading?'LOADING OCEAN FIELD':'FIELD UNAVAILABLE'}</b><small>{error||'Select a variable after the backend connects.'}</small><button onClick={loadCatalog}>Retry API</button></div></div>}
    <div className="legend"><span>LOW</span><div/><span>HIGH</span><b>{meta.unit}</b></div>
    <footer className="timeline"><div><span>TIME SERIES</span><b>{timeIndex+1}</b></div><input type="range" min="0" max={Math.max(0,(stats?.timeCount||1)-1)} value={timeIndex} onChange={e=>setTimeIndex(+e.target.value)}/><span>{stats?.timeCount>1?`${timeIndex+1} / ${stats.timeCount}`:'Dataset time coordinate'}</span></footer>
  </main>
}
