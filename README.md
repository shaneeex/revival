# Revival Signage (Cloudinary + Overlay Control)

This project runs a signage display with:

1. Main slideshow (Cloudinary media + optional remote site images)
2. News slides integrated into the main slideshow
3. Sponsor logo section
4. Time-up overlay (now remotely toggleable)

## Cloudinary Automation

- Upload images/videos directly from `/admin` to Cloudinary
- Slideshow auto-loads assets from Cloudinary by tag
- No manual playlist editing required for daily updates

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

## Cloudinary + Admin Auth Setup (One Time)

Update `runtime-config.json`:

```json
{
  "apiBaseUrl": "",
  "cloudinary": {
    "enabled": true,
    "cloudName": "YOUR_CLOUD_NAME",
    "uploadMode": "unsigned",
    "tag": "signage",
    "folder": "revival",
    "uploadPreset": "signage",
    "defaultImageDurationMs": 10000,
    "maxItems": 80
  }
}
```

Upload modes:
- `uploadMode: "unsigned"` -> uses `uploadPreset` directly (simple, no Cloudinary API key/secret needed for upload)
- `uploadMode: "signed"` -> uses `/api/cloudinary-signature` and requires Cloudinary API key/secret env vars

Set these environment variables on Vercel (or your backend host):
- `ADMIN_USERNAME` (example: `admin`)
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET` (long random string)
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_UPLOAD_FOLDER` (example: `revival`)
- `CLOUDINARY_UPLOAD_TAG` (example: `signage`)

Cloudinary requirements:
- Enable **Resource list** (needed for `.../image/list/<tag>.json` and `.../video/list/<tag>.json`)
- Use same tag as `runtime-config.json` (example: `signage`)

## Admin Workflow

1. Go to `/admin-login.html` and sign in
2. Select media files and click `Upload to Cloudinary`
3. Manage the **Content List** (remove/reorder/update image duration) without deleting from Cloudinary
4. Toggle `Enable "Time Up" overlay` when needed

The signage frontend polls overlay settings and Cloudinary media automatically.

## Vercel Note

- `api/settings.js` handles overlay toggle on Vercel.
- For persistence on Vercel, connect **Vercel KV** (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) or Upstash env names (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`).
- If KV is unavailable, API now falls back to Cloudinary state storage when these are set: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (optional `CLOUDINARY_STATE_PREFIX`).
- If overlay toggle fails, check `https://your-domain/api/settings` directly in browser.

## Media Source

- Cloudinary tagged resources (`image/list/<tag>.json` and `video/list/<tag>.json`)
- Fallback: local `media/playlist.json` if Cloudinary is not enabled
- Runtime settings: `config/settings.json`
- Runtime API config: `runtime-config.json`

## API Endpoints

- `POST /api/login`
- `GET /api/session`
- `POST /api/logout`
- `POST /api/cloudinary-signature`
- `GET /api/env-check`
- `GET /api/playlist`
- `PUT /api/playlist`
- `GET /api/settings`
- `PUT /api/settings`

## Notes

- Service worker is configured to bypass `/api/*` requests.
- Android performance mode is still enabled automatically.
