# SolvX 3D Ocean Explorer

Live React + Three.js frontend for the SolvX ocean-data API.

## Run

The frontend expects the SolvX FastAPI backend at `http://127.0.0.1:8000` by default.

### Terminal 1 — backend

```bash
cd /path/to/solvx/backend
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Terminal 2 — frontend

```bash
cd /path/to/3d-ocean
npm install
npm run dev
```

Open the URL printed by Vite, normally `http://127.0.0.1:5173`.

To use another backend URL:

```bash
VITE_API_URL=http://127.0.0.1:8000 npm run dev
```

## Live data flow

```text
Three.js / React
      |
      | HTTP
      v
SolvX FastAPI :8000
      |
      v
backend/data/model/*.nc
```

The browser does not read NetCDF files directly. The backend reads them with xarray and returns bounded JSON fields.

## Current frontend features

- Live dataset and variable discovery from `/datasets` and `/variables/{filename}`
- Temperature, salinity, currents, sea-level and other backend variables when available
- 3D volume field rendering using `THREE.Data3DTexture`
- Surface color field
- Depth clipping
- 3D, TOP, PROFILE and UNDER camera modes
- Field opacity control
- Dynamic legend and grid dimensions
- API connection/error status
- Time-series control when the backend response contains multiple time values
- Responsive Copernicus-style dark ocean UI
- Reset, fullscreen and hide/show controls

## Data locations

Scientific NetCDF data belongs to the SolvX backend, for example:

```text
solvx/backend/data/model/temperature.nc
solvx/backend/data/model/salinity.nc
solvx/backend/data/model/currents.nc
solvx/backend/data/model/sea level.nc
```

GEBCO, Natural Earth and EEZ archives used by the Python preprocessing pipeline remain separate from the live API data path.
