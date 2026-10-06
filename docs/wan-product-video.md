# ClipMint local Wan product video

Route: **/product-video/wan**. API: **/api/wan/**.

The original studio keeps its existing Go/Echo API, Runway recipe, OpenAI voice and FFmpeg WASM behavior. The existing /meta-ai page/component from feature/meta-ai-product-video-flow are carried forward verbatim. No Go API contracts are changed.

The new flow uses a **local Next.js Node backend plus a separate persistent worker**. This adds durable jobs, file storage and native FFmpeg without a database, Redis, login or changes to the stateless Go service. OpenAI remains the vision/TTS provider already used by ClipMint; a server-side Responses/Speech adapter and a new GPT Image edits adapter serve the new flow. They read server configuration rather than using the original Go mock fallback.

## Run locally

Requirements: Node 24+, npm, FFmpeg and ffprobe in PATH.

    npm install
    npm run dev:wan

Open http://localhost:3000/product-video/wan.

For production on the same machine:

    npm run build
    npm run start:wan

These commands start Next and the worker, bind the web server to 127.0.0.1, and stop both when the command stops. If Next is already running, run **npm run wan:worker** in another terminal. Both must use the same working directory and CLIPMINT_DATA_DIR.

FFmpeg installation:

- Windows: winget install Gyan.FFmpeg, then open a new terminal.
- macOS: brew install ffmpeg.
- Ubuntu: sudo apt install ffmpeg.

The new backend is not designed for Vercel/serverless or a read-only filesystem. Its API rejects non-local hostnames by default. Advanced users can explicitly list trusted local hostnames in CLIPMINT_LOCAL_HOSTS; this does not add authentication.

## Configuration

Open **Cấu hình AI** from the Wan route:

- fal.ai key, endpoint fal-ai/wan/v2.2-a14b/image-to-video/turbo.
- OpenAI key; defaults: vision/text gpt-4.1-mini, image edit gpt-image-1, TTS gpt-4o-mini-tts.
- Resolution, seed, acceleration, video quality, write mode and prompt expansion.
- Polling timeout/interval and concurrency (1–4 outstanding jobs, including provider jobs between polls).

Keys are saved only in backend settings.json. Reading settings returns configuration flags and a full mask, never the stored key. Blank key inputs preserve existing keys. Settings and data are gitignored and excluded from Next output tracing. Never prefix provider keys with NEXT_PUBLIC_.

Alternatively, provide FAL_KEY, OPENAI_API_KEY, OPENAI_TEXT_MODEL, OPENAI_TTS_MODEL in .env.local or environment. The standalone worker loads Next environment files. Saved settings take precedence.

**Kiểm tra cấu hình** checks supported schema, settings and installed dependencies. It does not call inference or verify key permissions, balance or actual generation. No suitable free fal key-validation API was verified; use the fal dashboard for account checks.

Only the registered Wan endpoint is supported. A different endpoint is rejected until its adapter/capability schema is implemented; field names are never inferred from a model name.

## Workflow

1. Create/open a project, upload JPEG/PNG/WebP (20 MB each, up to 12 original images). Files must fully decode, be at least 64 px and at most 40 megapixels. Select the main image and optionally enter product facts.
2. Ask vision for 3–5 suggestions or add manual scenes. Edit background and motion separately. The first scene starts from the main image. Each scene can skip background generation and use its selected original/saved image directly.
3. Generate a background with GPT Image edits. Up to 8 original reference images are sent, primary/source first. Review the local preview and edit/regenerate or select another saved preview.
4. Click **Duyệt ảnh & tạo video Wan**. Wan receives exactly one image_url plus prompt and verified parameters. It is not treated as a multi-reference model.
5. Optionally extract audio from a publicly downloadable video URL, upload MP3/WAV/M4A (100 MB), or approve a script and generate narration. Select a time segment and voice/music volumes. Unsupported websites/login walls report an error and suggest file upload. No yt-dlp/login automation is enabled.
6. Explicitly generate each selected scene. **Ghép & xuất MP4** concatenates scene videos, removes original audio, mixes selected audio/music and optionally burns subtitles. With audio toggled off, MP4 has no audio track.

Changing audio, trims, volumes or subtitles only recomposes MP4; composition has no code path that submits Wan. If audio is longer, choose trimming or add/generate another scene explicitly. The worker never purchases extra scenes automatically.

The endpoint supports 480p, 580p, 720p and auto/16:9/9:16/1:1. **There is no duration input in the verified schema**, so there is no invented duration selector. Duration is probed from downloaded output. GPT Image uses documented portrait/landscape/square dimensions; Wan applies its documented center crop to match the chosen video ratio.

Subtitle timing is approximate: short verbatim chunks of the approved narration are distributed over the generated voice duration, then adjusted for trim offsets. The UI labels this. Subtitles/transcription for arbitrary imported audio are not offered.

Generation may vary product appearance; review logo, proportions and details. Advertising copy is prompted to use visible/user-supplied facts and not invent prices, material or effectiveness. Review the text before TTS.

## Durable storage

Default: **clipmint-web-app/.clipmint-data/**.

Set CLIPMINT_DATA_DIR to an absolute directory, e.g. Windows D:/ClipmintData. Back up this directory if needed; it contains plaintext personal provider keys.

| Location | Contents |
| --- | --- |
| settings.json | Provider configuration and keys |
| projects/ID/project.json | Product fields, UI selections, scenes, asset hashes, script, revision |
| projects/ID/assets/ | Original uploads and independent copies of generated/downloaded media |
| jobs/ID.json | Input snapshot, cache key, step/status, provider ID and queue URLs |
| cache/HASH/ | Successful cached data/media and completion metadata |
| temp/ | Temporary conversion/composition files |
| locks/, worker.json | Cross-process locks and worker heartbeat |

Writes use temporary-file/rename and revisions. Running-job inputs are frozen; edits/uploads are blocked until the job finishes. Autosave persists editable choices; the project ID in the URL restores the selection.

Cache identities include content hashes, normalized prompts, model and output-affecting parameters. Final identities include source video/audio/music hashes, segment/volume settings and subtitles/narration. Keys and runtime timeout/poll settings are excluded. URL extraction downloads bytes first and caches their content hash.

Success entries are written only after media validation. Missing files are not reused. **Tạo lại** skips completed cache. Active duplicate requests are serialized/deduplicated by cross-process locks. Cache deletion is blocked while any job is queued/running/polling and only removes cache/, never project originals/outputs.

## Recovery and billing boundary

The worker scans durable jobs at startup. Immediately after fal submit returns, its request ID and status/result URLs are persisted before polling. Reloading the UI or restarting the worker polls that same ID.

Polling/download failure pauses the job. Retrying that step, or clicking create again for the same input, resumes the existing ID. It never automatically submits a replacement paid job.

If a process/connection dies during submit before an ID can be persisted, state becomes **uncertain**. No provider idempotency guarantee is assumed. Check the fal dashboard and enter its request ID to resume. For synchronous OpenAI calls interrupted by restart, the UI requires explicit acknowledgement before resending.

A PID lock prevents a second worker on the same local filesystem. Stale locks from a dead process are reclaimed at restart. This storage is for one machine, not clustered/network filesystems.

## API outline

- GET/PUT settings; POST settings/test.
- GET/POST projects; GET/PATCH projects/ID (PATCH requires current revision).
- POST projects/ID/assets (multipart file/kind).
- GET/DELETE projects/ID/assets/ASSET_ID (GET supports ranges/download).
- POST projects/ID/jobs: action, optional sceneId and force.
- POST jobs/ID/retry: optional recovered requestId or acknowledgeUncertain.
- GET/DELETE cache.

All endpoints use the /api/wan/ prefix. Actions: suggest, improve, copy, image, video, tts, extract, compose.

## Verification

    npm run lint
    npm run typecheck
    npm test
    npm run build
    npm run test:wan-local

Tests use synthetic media and stubbed provider HTTP, never real keys/inference. The local smoke test forces keys empty, starts real Next/worker processes, verifies upload/settings/projects across a full restart, checks missing-key errors and old/new routes.

Verified locally: 50 tests (including 32 existing regression tests), native silent/audio/subtitle MP4, job dedup/resume/ambiguous submit/concurrency, cache existence/deletion, settings masking, upload decode and URL boundaries.

Not verified without keys: actual fal generation/quota, OpenAI vision/image edits/TTS quality and real external video downloading. Browser visual/hydration automation could not run because Chromium was unavailable and its download was blocked; HTTP/API smoke and production builds were used.

## Official references checked 2026-10-06

- [Wan Turbo schema](https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video/turbo/api)
- [fal queue lifecycle](https://fal.ai/docs/documentation/model-apis/inference/queue)
- [OpenAI image edit API](https://developers.openai.com/api/reference/resources/images)
- [OpenAI speech API](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)
- [OpenAI voices](https://developers.openai.com/api/docs/guides/text-to-speech)
