# ClipMint Web App

Vietnamese Next.js interface for the ClipMint AI MVP. It turns either a local raw product video or editable product images from a URL/upload into up to three 15–30 second vertical affiliate videos.

The full raw video and original locally uploaded images never leave the browser. A maximum of 8 adaptively compressed representative WebP frames or product images are sent to the stateless backend so Vision can describe each visual and align it with the script. In URL-only mode, the backend also safely proxies selected remote product images to avoid CORS failures. Smart Motion 2.5D creates blurred depth layers, independent foreground motion, light sweeps, and crossfades locally with `ffmpeg.wasm`.

Image-only projects can optionally use AI Product Video. In this mode the same bounded compressed images are sent through the backend to Runway's Product Ad recipe, which can consume Runway credits. The browser polls the stateless task endpoint, downloads the completed silent video directly, then mixes the selected OpenAI voice and subtitles locally.

## Requirements

- Node.js 24+
- npm 11+
- The sibling `clipmint-service` backend
- A modern Chromium browser is recommended

## Local setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`. The default backend is `http://localhost:8080`.

## Environment variables

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
```

Never put an OpenAI or Runway API key in this repository. Provider calls are made by the Go backend only.

## Commands

```bash
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

`npm install` copies the single-thread FFmpeg core assets from `@ffmpeg/core` into `public/ffmpeg`. They are not fetched from a third-party CDN at runtime.

## OpenAPI synchronization

`clipmint-service/openapi/openapi.yaml` is the source of truth. Generated types are committed at `src/lib/api/schema.d.ts`.

With both repositories checked out as siblings:

```bash
npm run generate:api
```

To use another checkout location:

```bash
CLIPMINT_OPENAPI_PATH=/absolute/path/to/openapi.yaml npm run generate:api
```

On Windows PowerShell:

```powershell
$env:CLIPMINT_OPENAPI_PATH="C:\path\to\openapi.yaml"
npm run generate:api
```

## Browser limitations

- File System Access API is best supported in Chromium. Other browsers use a normal MP4 download fallback.
- FFmpeg WebAssembly is CPU- and memory-intensive. 4K input is accepted only with a warning and can be slow; 1080p vertical video is recommended.
- Rendering happens sequentially to control memory use. Closing or refreshing the tab cancels in-progress work.
- AI Product Video is currently limited to 15 seconds, requires `RUNWAY_API_KEY` on the backend, and depends on the generated output URL allowing browser CORS downloads.
- URL-only rendering requires at least one usable product image. Users can remove or replace every URL-derived image and upload up to eight local JPEG, PNG, or WebP images.
- H.264/AAC support depends on the bundled FFmpeg core and browser WebAssembly support.
- Cross-origin isolation headers are configured for WebAssembly. A hosting platform must preserve these headers.

## Local video privacy

- The browser reads the selected video through a local object URL.
- Canvas extracts up to 8 representative frames at a maximum width of 480 px. Every frame is adaptively compressed to at most 180 KB and the total decoded image budget is 1.5 MB, keeping the Base64 JSON request safely below Vercel's function payload limit.
- URL-only mode applies the same limits to product images and sends them in asset order so the backend can map every image description to its render index. Selecting AI Product Video also forwards those compressed images to Runway; the original files are not forwarded.
- The complete source file is passed only to the local render worker.
- The backend does not receive or store the complete raw video.
- Generated Blob URLs remain local to the current tab until saved or downloaded.

## MVP scope

Included: local video or product-image input, editable URL enrichment, frame or product-only analysis, AI hooks, one-to-three hook selection, edit/motion-plan validation, Smart Motion 2.5D, optional Runway AI Product Video, TTS, Web Worker rendering, subtitles/overlays, preview, save/download, and regenerate.

Not included: accounts, database, payment, cloud storage, background queues, social posting, voice cloning, AI avatars, or authenticated marketplace scraping.
