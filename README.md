# Revival Signage (Local + Admin Backend)

This project runs a signage display with:

1. Main slideshow (local media + optional remote site images)
2. News slides integrated into the main slideshow
3. Sponsor logo section
4. Time-up overlay (now remotely toggleable)

## New Backend Features

- Upload image/video files from a web admin panel
- Reorder and edit playlist durations without editing JSON manually
- Delete media files from disk
- Toggle Time Up overlay ON/OFF from admin panel

## Quick Start

1. Install dependencies:

```powershell
cd d:\revival-signage-local
npm install
```

2. Start server:

```powershell
npm start
```

3. Open signage screen:

`http://localhost:8080`

4. Open admin panel:

`http://localhost:8080/admin`

## Local Network Access

On another device in same Wi-Fi (example IP):

- Signage: `http://192.168.1.50:8080`
- Admin: `http://192.168.1.50:8080/admin`

## Admin Panel Workflow

1. Go to `/admin`
2. Upload media files
3. Reorder playlist (Move Up/Down)
4. Set image durations (ms)
5. Click `Save Playlist`
6. Toggle `Enable "Time Up" overlay` and save settings

The signage frontend polls settings and applies overlay ON/OFF automatically.

## Media + Playlist Storage

- Media files: `media/`
- Playlist file: `media/playlist.json`
- Runtime settings: `config/settings.json`

Playlist format:

```json
[
  { "file": "intro.mp4", "type": "video" },
  { "file": "promo1.jpg", "type": "image", "duration": 12000 }
]
```

## API Endpoints

- `GET /api/playlist`
- `PUT /api/playlist`
- `POST /api/media/upload` (multipart form, key: `files`)
- `DELETE /api/media/:name`
- `GET /api/settings`
- `PUT /api/settings`

## Notes

- Service worker is configured to bypass `/api/*` requests.
- Android performance mode is still enabled automatically.
