import json


def render(data):
    payload = json.dumps(data, separators=(",", ":"))
    html = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>SolvX — Bay of Bengal 3D</title>
<style>
*{box-sizing:border-box}html,body,#app{margin:0;width:100%;height:100%;overflow:hidden;background:#eef3f0}
body{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#18221e}
#app{position:fixed;inset:0}canvas{display:block;width:100%!important;height:100%!important}
#topbar{position:absolute;top:16px;left:16px;right:16px;z-index:10;display:flex;align-items:flex-start;justify-content:space-between;pointer-events:none}
.brand,.toolbar,.panel,.hint,.readout{background:rgba(248,250,248,.90);border:1px solid rgba(24,34,30,.13);box-shadow:0 10px 34px rgba(35,52,45,.11);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
.brand{padding:10px 14px;border-radius:12px;pointer-events:auto}.brand b{display:block;font-size:13px;letter-spacing:.13em}.brand small{display:block;margin-top:3px;color:#65726c;font-size:8px;letter-spacing:.035em}
.toolbar{display:flex;gap:5px;padding:5px;border-radius:12px;pointer-events:auto}
.btn{border:0;background:transparent;color:#53615a;border-radius:8px;padding:9px 11px;font-size:9px;letter-spacing:.09em;cursor:pointer}.btn:hover{background:#edf1ee;color:#17221d}.btn.active{background:#fff4dc;color:#805814;box-shadow:inset 0 0 0 1px #d8aa57}
#panel{position:absolute;top:84px;right:16px;width:285px;padding:15px;border-radius:14px;z-index:11;display:none}.panel-show{display:block!important}
.panel h3{margin:0 0 12px;font-size:11px;letter-spacing:.12em;text-transform:uppercase}.section{padding:11px 0;border-top:1px solid rgba(24,34,30,.10)}.section:first-of-type{border-top:0;padding-top:0}
.section-title{font-size:9px;color:#69766f;letter-spacing:.09em;text-transform:uppercase;margin-bottom:9px}
.layers{display:grid;grid-template-columns:1fr 1fr;gap:6px}.layer{display:flex;align-items:center;gap:7px;padding:8px;border:1px solid rgba(24,34,30,.10);border-radius:8px;background:#f7f9f7;color:#4d5b54;font-size:9px;cursor:pointer}.layer.off{opacity:.43}.dot{width:7px;height:7px;border-radius:50%;background:#3f7d45}.layer[data-g="terrain"] .dot{background:#a27645}.layer[data-g="eez"] .dot{background:#c78318}.layer[data-g="base"] .dot{background:#735b46}.layer[data-g="coast"] .dot{background:#17221d}
.range-row{display:flex;align-items:center;gap:9px}.range-row input{width:100%}.value{min-width:42px;text-align:right;font-size:9px;color:#7a5b25;font-variant-numeric:tabular-nums}
.depth-note{font-size:8px;color:#748078;line-height:1.45;margin-top:6px}.legend-item{display:flex;align-items:center;gap:8px;margin:7px 0;font-size:9px;color:#53615a}.sw{width:22px;height:4px;border-radius:3px;display:inline-block}
#hint{position:absolute;left:16px;bottom:16px;padding:8px 11px;border-radius:9px;color:#65726c;font-size:8px;z-index:8}#readout{position:absolute;right:16px;bottom:16px;padding:8px 11px;border-radius:9px;color:#59675f;font-size:8px;z-index:8;font-variant-numeric:tabular-nums}
#load{position:absolute;inset:0;background:#eef3f0;display:grid;place-items:center;z-index:50}.loading{text-align:center}.loading b{display:block;font-size:20px;letter-spacing:.16em}.loading span{display:block;margin-top:6px;font-size:9px;color:#75827b;letter-spacing:.08em}
@media(max-width:760px){#topbar{top:8px;left:8px;right:8px}.brand small{display:none}.toolbar .btn{padding:9px 8px}.toolbar .btn:nth-child(4){display:none}#panel{top:70px;right:8px;width:calc(100vw - 16px)}#hint{left:8px;bottom:8px}#readout{right:8px;bottom:8px}}
</style></head>
<body><div id="app">
<div id="load"><div class="loading"><b>SOLVX</b><span>INITIALISING 3D TERRAIN</span></div></div>
<div id="topbar"><div class="brand"><b>SOLVX</b><small>BAY OF BENGAL · 84.105°–92.993°E · 16.071°–23.524°N</small></div>
<div class="toolbar"><button class="btn active" data-v="overview">3D</button><button class="btn" data-v="top">TOP</button><button class="btn" data-v="profile">PROFILE</button><button class="btn" data-v="under">UNDER</button><button class="btn" id="layersBtn">LAYERS</button><button class="btn" id="fullBtn">FULLSCREEN</button></div></div>
<div id="panel" class="panel"><h3>Visualization</h3>
<div class="section"><div class="section-title">Layers</div><div class="layers">
<button class="layer" data-g="terrain"><i class="dot"></i>Seabed</button><button class="layer" data-g="land"><i class="dot"></i>Land mass</button>
<button class="layer" data-g="coast"><i class="dot"></i>Coastlines</button><button class="layer" data-g="eez"><i class="dot"></i>EEZ boundary</button>
<button class="layer" data-g="base"><i class="dot"></i>Geological base</button></div></div>
<div class="section"><div class="section-title">Bathymetry depth scale</div><div class="range-row"><input id="depth" type="range" min="1" max="10" step="0.5" value="10"><span id="depthVal" class="value">10.0×</span></div><div id="depthNote" class="depth-note"></div></div>
<div class="section"><div class="section-title">Map key</div><div class="legend-item"><i class="sw" style="background:#3f7d45"></i>Land at sea level</div><div class="legend-item"><i class="sw" style="background:#a27645"></i>GEBCO depth surface</div><div class="legend-item"><i class="sw" style="background:#c78318"></i>EEZ boundary / beads</div><div class="legend-item"><i class="sw" style="background:#735b46"></i>Solid geological material</div></div>
</div>
<div id="hint" class="hint">Drag orbit · Right/Shift drag pan · Wheel zoom · 1–4 views · R reset</div><div id="readout" class="readout">GEBCO bathymetry</div></div>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
const D=__PAYLOAD__;
const scene=new THREE.Scene();scene.background=new THREE.Color(0xeef3f0);scene.fog=new THREE.FogExp2(0xeef3f0,.00048);
const cam=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.1,5000);cam.position.set(430,-520,330);
const ren=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});ren.setPixelRatio(Math.min(devicePixelRatio,2));ren.setSize(innerWidth,innerHeight);ren.outputColorSpace=THREE.SRGBColorSpace;ren.shadowMap.enabled=true;ren.shadowMap.type=THREE.PCFSoftShadowMap;document.getElementById('app').appendChild(ren.domElement);
const ctl=new OrbitControls(cam,ren.domElement);ctl.enableDamping=true;ctl.dampingFactor=.055;ctl.screenSpacePanning=true;ctl.minDistance=25;ctl.maxDistance=1800;ctl.target.set(0,0,0);
scene.add(new THREE.HemisphereLight(0xf8fbff,0x806b58,2.15));const sun=new THREE.DirectionalLight(0xfff2d8,3.2);sun.position.set(-320,-380,760);sun.castShadow=true;scene.add(sun);
const G={terrain:new THREE.Group(),land:new THREE.Group(),coast:new THREE.Group(),eez:new THREE.Group(),base:new THREE.Group()};Object.values(G).forEach(g=>scene.add(g));
const mats={land:new THREE.MeshStandardMaterial({color:0x3f7d45,roughness:.88}),side:new THREE.MeshStandardMaterial({color:0x704f35,roughness:1}),bottom:new THREE.MeshStandardMaterial({color:0x684a34,roughness:1}),coast:new THREE.LineBasicMaterial({color:0x17221d}),eez:new THREE.LineBasicMaterial({color:0xb26f0c}),bead:new THREE.MeshStandardMaterial({color:0xc78318,roughness:.42}),base:new THREE.MeshStandardMaterial({color:0x735b46,roughness:1})};
let depthScale=10.0;
// Bathymetry uses the actual GEBCO negative elevation/depth values.  The z coordinate is recomputed from raw depth in km whenever the depth exaggeration changes.
(function(){const xs=D.terrain.x,ys=D.terrain.y,raw=D.terrain.rawDepthKm,nx=xs.length,ny=ys.length,pos=new Float32Array(nx*ny*3),col=new Float32Array(nx*ny*3),ind=[];let max=0;for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const d=raw[j][i];if(Number.isFinite(d))max=Math.max(max,d)}D.terrain.maxRawDepthKm=max;
for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const k=j*nx+i,o=k*3,d=raw[j][i];pos[o]=xs[i];pos[o+1]=ys[j];pos[o+2]=Number.isFinite(d)?-d*depthScale:0;const t=Number.isFinite(d)?Math.min(1,d/Math.max(1,max)):0;col[o]=.78-.30*t;col[o+1]=.66-.30*t;col[o+2]=.46-.22*t}
for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){const a=j*nx+i,b=a+1,c=a+nx,d=c+1;if([raw[j][i],raw[j][i+1],raw[j+1][i],raw[j+1][i+1]].every(Number.isFinite))ind.push(a,c,b,b,c,d)}
const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('color',new THREE.BufferAttribute(col,3));g.setIndex(ind);g.computeVertexNormals();const m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.76,side:THREE.DoubleSide});const mesh=new THREE.Mesh(g,m);mesh.receiveShadow=true;G.terrain.add(mesh);D._terrainMesh=mesh;})();
// Land top is exactly sea level (z=0). Its vertical sides and underside are solid soil, extending down to the geological base.
function poly(p){if(p.vertices&&p.triangles&&p.triangles.length){const v=[];p.vertices.forEach(q=>v.push(q[0],q[1],0));const ix=[];p.triangles.forEach(t=>ix.push(t[0],t[1],t[2]));const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(ix);g.computeVertexNormals();const m=new THREE.Mesh(g,mats.land);m.castShadow=true;m.receiveShadow=true;G.land.add(m)}if(p.top&&p.top.length>1){const v=[],ix=[];for(let i=0;i<p.top.length-1;i++){const a=p.top[i],b=p.top[i+1],q=v.length/3;v.push(a[0],a[1],0,a[0],a[1],-1,b[0],b[1],0,b[0],b[1],-1);ix.push(q,q+2,q+1,q+2,q+3,q+1)}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(ix);g.computeVertexNormals();const m=new THREE.Mesh(g,mats.side);m.castShadow=true;m.receiveShadow=true;G.land.add(m)}if(p.vertices&&p.triangles&&p.triangles.length){const v=[];p.vertices.forEach(q=>v.push(q[0],q[1],0));const ix=[];p.triangles.forEach(t=>ix.push(t[2],t[1],t[0]));const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(ix);g.computeVertexNormals();const m=new THREE.Mesh(g,mats.bottom);m.receiveShadow=true;G.land.add(m)}}
D.land.forEach(poly);D.islands.forEach(poly);
function draw(parts,mat,z){parts.forEach(p=>{if(p.length<2)return;const q=p.map(x=>new THREE.Vector3(x[0],x[1],z));G.coast.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(q),mat))})}draw(D.coast,mats.coast,.025);draw(D.landBoundary,mats.coast,.03);draw(D.islandCoast,mats.coast,.035);
D.eez.forEach(p=>{if(p.length<2)return;G.eez.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p.map(x=>new THREE.Vector3(x[0],x[1],.06))),mats.eez))});const beadGeo=new THREE.SphereGeometry(2.0,12,8);D.eezBeads.forEach(p=>{const m=new THREE.Mesh(beadGeo,mats.bead);m.position.set(p[0],p[1],.10);m.castShadow=true;G.eez.add(m)});
// The base is below the deepest seabed. Land is separately sunk into the same soil block so there is no hollow/empty underside.
const W=(D.bounds[1]-D.bounds[0])*111.32*Math.cos(((D.bounds[2]+D.bounds[3])/2)*Math.PI/180),H=(D.bounds[3]-D.bounds[2])*111.32;const baseExtra=D.baseExtra*depthScale;
const seaMat=new THREE.LineBasicMaterial({color:0x5b8f9a,transparent:true,opacity:.42});const seaPts=[new THREE.Vector3(-W/2,-H/2,0),new THREE.Vector3(W/2,-H/2,0),new THREE.Vector3(W/2,H/2,0),new THREE.Vector3(-W/2,H/2,0),new THREE.Vector3(-W/2,-H/2,0)];G.coast.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(seaPts),seaMat));
const baseMesh=new THREE.Mesh(new THREE.BoxGeometry(W,H,1),mats.base);baseMesh.receiveShadow=true;G.base.add(baseMesh);
function updateDepth(){const raw=D.terrain.rawDepthKm,mesh=D._terrainMesh,pos=mesh.geometry.attributes.position.array,nx=D.terrain.x.length,ny=D.terrain.y.length;for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const k=j*nx+i,o=k*3,d=raw[j][i];pos[o+2]=Number.isFinite(d)?-d*depthScale:0}mesh.geometry.attributes.position.needsUpdate=true;mesh.geometry.computeVertexNormals();
const deepest=-D.terrain.maxRawDepthKm*depthScale;const soil=Math.max(1.5,D.landThickness*depthScale);const baseTop=deepest-0.8;const baseBottom=baseTop-(D.baseExtra*depthScale);G.base.position.z=(baseTop+baseBottom)/2;baseMesh.scale.z=(baseBottom-baseTop);
G.land.children.forEach(m=>{if(m.material===mats.side||m.material===mats.bottom)m.scale.z=soil});
const note=document.getElementById('depthNote');note.textContent=`Deepest GEBCO: ${D.terrain.maxRawDepthKm.toFixed(2)} km · displayed: ${(D.terrain.maxRawDepthKm*depthScale).toFixed(1)} km · land soil: ${D.landThickness.toFixed(1)} km`;document.getElementById('depthVal').textContent=depthScale.toFixed(1)+'×'}
updateDepth();
const views={overview:[420,-520,430],top:[0,0,980],profile:[760,-20,150],under:[420,-520,-250]};let motion=null;function view(n){const v=views[n];motion={a:cam.position.clone(),b:new THREE.Vector3(...v),ta:ctl.target.clone(),tb:new THREE.Vector3(0,0,n==='under'?-.35:-.15),t:performance.now()};document.querySelectorAll('[data-v]').forEach(b=>b.classList.toggle('active',b.dataset.v===n))}function reset(){view('overview')}function step(){if(!motion)return;const u=Math.min(1,(performance.now()-motion.t)/700),e=1-Math.pow(1-u,3);cam.position.lerpVectors(motion.a,motion.b,e);ctl.target.lerpVectors(motion.ta,motion.tb,e);if(u>=1)motion=null}
document.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>view(b.dataset.v));document.getElementById('layersBtn').onclick=()=>document.getElementById('panel').classList.toggle('panel-show');document.getElementById('fullBtn').onclick=async()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen?.();
document.querySelectorAll('.layer').forEach(b=>b.onclick=()=>{const g=b.dataset.g;G[g].visible=!G[g].visible;b.classList.toggle('off',!G[g].visible)});document.getElementById('depth').oninput=e=>{depthScale=+e.target.value;updateDepth()};
addEventListener('keydown',e=>{if(e.key==='1')view('overview');else if(e.key==='2')view('top');else if(e.key==='3')view('profile');else if(e.key==='4')view('under');else if(e.key.toLowerCase()==='r')reset();else if(e.key.toLowerCase()==='f')document.getElementById('fullBtn').click()});addEventListener('resize',()=>{cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();ren.setSize(innerWidth,innerHeight)});
document.getElementById('load').style.display='none';view('overview');(function loop(){requestAnimationFrame(loop);step();ctl.update();ren.render(scene,cam)})();
</script></body></html>'''
    return html.replace("__PAYLOAD__", payload)
