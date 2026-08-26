# Mula-Mutha Cinematic Journey

Independent Vite + Three.js geospatial flythrough.

- KML polygon is the river alignment/boundary (`public/data/mula_mutha_river.kml`).
- CSV is bathymetry (`public/data/depth_pixels.csv`).
- Projection: WGS84 → EPSG:32643, then local meters.
- Flow: Khadakwasla / upstream (west) → Sangam → downstream (east).
- Do not merge with Hydrology V2 or `geospatial-mula-mutha`.

```bash
npm install
npm run dev
```

http://localhost:5176/

## CI / CD

```bash
npm run ci          # production build + smoke checks
```

GitHub Actions (in `.github/workflows/`):

- **CI** — on PR/push to `main`: `npm ci` → build → smoke → upload `dist` artifact
- **Deploy** — on push to `main`: build with Pages base → GitHub Pages

Enable **Settings → Pages → Source: GitHub Actions** after the first push.
