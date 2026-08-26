# Mula–Mutha River Journey

Standalone **3D hydrology visualization** of the Mula–Mutha river corridor (Pune).  
Vite + Three.js · KML-aligned terrain · Excel bathymetry · OSM urban context · fishing points · cinematic water flow.

> Independent prototype — do **not** merge into sibling `Shweta/` terrain projects.

---

## Features

| Area | What you get |
|------|----------------|
| **River & bathymetry** | KML corridor banks, CSV depth model (~0.5–2 m), depth-tinted water, hover depth readout |
| **Terrain** | Approximate corridor banks / hills (EPSG:32643 local metres) |
| **Urban** | OSM buildings (GLB kits + extrusions), roads, bridges, trees / vegetation |
| **Chainage** | Red pins along the analysis KML — click & hover for station (`0+000`) or metres |
| **Fishing** | KML fishing locations with colorful, distance-readable fish schools |
| **Cinematic** | **Start Water Flow** — flythrough from upstream (west) toward Sangam / downstream |
| **Cameras** | Overview · Local 3D · Bathymetry · River Path Follow · Reset |

---

## Quick start

**Requirements:** Node.js **20+**

```bash
cd mula-mutha-cinematic
npm install
npm run dev
```

Open **http://localhost:5176/**

| Script | Purpose |
|--------|---------|
| `npm run dev` | Local Vite server (port `5176`) |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview production build (port `4176`) |
| `npm start` | Serve `dist/` on `$PORT` (Railway / local static) |
| `npm run smoke` | Post-build asset checks |
| `npm run ci` | `build` + `smoke` |

---

## How to use the app

1. Wait for the loading bar (KML + CSV + OSM layers).
2. Click **Start Water Flow** for the cinematic journey, or explore with the camera bar.
3. **Layers** — toggle water, bathymetry, terrain, bridges, buildings, roads, trees, fish, chainage.
4. Hover the river for lon / lat / depth; click a **red chainage pin** then hover it for station / metres.
5. Bridge **B** badges appear in Overview; enable **Bridge names** in Layers when needed.

---

## Projection & data

| | |
|--|--|
| Input CRS | WGS84 (EPSG:4326) |
| Working CRS | **EPSG:32643** (UTM Zone 43N) |
| Scene | Local metres = UTM − shared origin |
| Flow direction | Upstream / west → Sangam → downstream / east |

### Key files (`public/data/`)

| File | Role |
|------|------|
| `Mula_MuthaAOI_2.kml` | Primary river AOI / bank polygon |
| `mula_mutha_water_depth.csv` | Survey / model depths (`lat`, `lon`, `depth_m`) |
| `Mula_Mutha_Chainage_Analysis.kml` | Chainage stations |
| `Fishing_Locations.kml` | Fishing point placemarks |
| `buildings.geojson` / `roads.geojson` / `bridges.geojson` / `trees.geojson` | OSM context |

Attribution and refresh pipelines: see [`DATA_SOURCES.md`](./DATA_SOURCES.md) and [`OSM_PIPELINE.md`](./OSM_PIPELINE.md).

```bash
# Refresh OSM along the KML corridor (needs Python + network)
npm run extract:osm
npm run enrich:osm
```

---

## Project layout

```
mula-mutha-cinematic/
├── public/data/          # KML, CSV, GeoJSON (served as-is)
├── public/assets/        # Building GLBs, fish models / textures
├── src/
│   ├── geo/              # Projection, KML/CSV load, corridor, OSM
│   ├── scene/            # Terrain, river, cameras, bridges, cinematic
│   ├── urban/            # Buildings, roads, GLB registry
│   ├── features/fishing/ # Fishing points + fish systems
│   ├── ui/               # HUD, layers, tooltips
│   └── main.js
├── scripts/              # OSM fetch, smoke, static serve
├── Dockerfile            # Railway / container deploy
├── Caddyfile             # Static SPA + /health
└── railway.toml
```

---

## Environment

Copy [`.env.example`](./.env.example) → `.env` if you need overrides.

| Variable | Default | Notes |
|----------|---------|--------|
| `VITE_BASE` | `/` | Asset base path. Use `/` on Railway; `/repo-name/` for GitHub project Pages |

---

## Deploy

### Railway (recommended)

Configured for Docker + Caddy (listens on Railway `$PORT`, healthcheck at `/health`).

1. Create a Railway project from this repo (or parent monorepo).
2. Set **Root Directory** to `mula-mutha-cinematic` if the Git root is the parent folder.
3. Optional variable: `VITE_BASE=/`
4. Deploy → open the generated domain.

| File | Role |
|------|------|
| `Dockerfile` | `npm ci` → `vite build` → Caddy serves `dist/` |
| `Caddyfile` | Gzip, SPA fallback, `/health` |
| `railway.toml` | Docker builder + healthcheck |
| `nixpacks.toml` | Fallback if Docker is disabled (`npm start`) |

Local static check after build:

```bash
npm run build
npm start
# → http://localhost:3000  (or $PORT)
```

### GitHub Pages

Workflows live in `.github/workflows/`:

- **CI** — build + smoke on push/PR
- **Deploy** — build with `VITE_BASE=/<repo>/` → GitHub Pages

Enable **Settings → Pages → Source: GitHub Actions** after the first successful deploy workflow.

---

## Tech stack

- [Vite 6](https://vitejs.dev/) · [Three.js](https://threejs.org/) · [proj4](https://github.com/proj4js/proj4js)
- Node **≥ 20** (see `.nvmrc`)

---

## License & attribution

- Map / urban context: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors  
- River geometry & bathymetry: project survey / analysis inputs bundled under `public/data/`  
- Keep this app separate from other Hydrology / geospatial prototypes under `Shweta/`
