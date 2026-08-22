# Upside Room Prototype

This is a standalone PlayCanvas prototype for the `倒置房间` concept.

## Current Scope

The current build focuses on:

- a walkable realistic apartment living-room scene
- warm `sunlight mode`
- cold `shadow mode`
- a real planar mirror using a reflected camera render target
- exact BVH capsule collision in the storage room, including furniture, stairs, and low thresholds
- upside-down ghost echoes on the ceiling in shadow mode
- three anomalies that only become collectible in shadow mode
- photo wall restoration as the core feedback loop

## Controls

- `Click`: lock the mouse pointer
- `W A S D`: move
- `Shift`: move faster
- `Q`: toggle between sunlight and shadow modes
- `E`: inspect the anomaly currently under the reticle

## Run Locally

Double-click `start.bat` in this folder. It starts a local server and opens:

`http://127.0.0.1:8123/index.html`

The bundled PlayCanvas and Ammo runtimes, GLB assets, and WebAssembly module must be opened through a local static server instead of double-clicking `index.html` directly.

If Python is available:

```powershell
cd C:\Users\许轩诚\Documents\ChatGPT\密室1\playcanvas-upside-room
python -m http.server 4173
```

If Python is not available, this Node one-liner also works:

```powershell
cd C:\Users\许轩诚\Documents\ChatGPT\密室1\playcanvas-upside-room
node -e "const http=require('http'),fs=require('fs'),path=require('path'); const root=process.cwd(); const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}; http.createServer((req,res)=>{ let p=decodeURIComponent((req.url||'/').split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(root,p); fs.readFile(f,(err,data)=>{ if(err){res.writeHead(404);res.end('Not found');return;} res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream'}); res.end(data); }); }).listen(4173,'127.0.0.1'); setInterval(()=>{},1<<30);"
```

Then open:

`http://localhost:4173`

## Notes

- The environment is now based on a downloaded ReplicaCAD baked-lighting scene instead of a hand-built blockout room.
- The second room uses a separate 41,395-triangle static collision mesh, a 1.70 m capsule controller, and a validated layered navigation mask. The first room keeps its original movement behavior.
- The mirror, clock, photo wall, vase, and mirror-only doll are still custom logic objects layered on top of that scene.
- This is still a prototype: the room is visually far more grounded now, but the level is not yet a finished art pass.
