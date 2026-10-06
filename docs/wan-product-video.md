# ClipMint Wan product video — local and Vercel

Route: **/product-video/wan**. API: **/api/wan/**.

The original studio keeps its existing Go/Echo API, Runway recipe, OpenAI voice and FFmpeg WASM behavior. The existing /meta-ai page/component from feature/meta-ai-product-video-flow are carried forward verbatim. No Go API contracts are changed.

The new flow uses a **Next.js Node backend**, with local filesystem + worker for home use, or private Vercel Blob + bounded function steps on Vercel. This adds durable jobs, file storage and native FFmpeg without a database, Redis, login or changes to the stateless Go service. OpenAI remains the vision/TTS provider already used by ClipMint; a server-side Responses/Speech adapter and a new GPT Image edits adapter serve the new flow. They read server configuration rather than using the original Go mock fallback.

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

## Deploy on Vercel

The same `/product-video/wan` route now runs on Vercel without a local worker or Go service changes. The backend detects `VERCEL=1`; do **not** point `CLIPMINT_DATA_DIR` at `/tmp` as durable storage.

1. Deploy this repository with the usual Next.js preset, Node 24, `npm run build`, and Fluid compute enabled. The Wan API sets `maxDuration=300`.
2. In **Storage → Create Database/Store → Blob**, create a **Private** store and connect it to the ClipMint project for Production and Preview. Keep the generated `BLOB_READ_WRITE_TOKEN` environment variable name. This token signs direct browser uploads; an OIDC-only connection does not suffice for this upload adapter.
3. Optionally add server-only `FAL_KEY` and `OPENAI_API_KEY`, or save those keys through **Cấu hình AI** after connecting Blob.
4. **Redeploy** after changing environment variables/store connections. Open `/product-video/wan` and verify the storage and FFmpeg statuses.

Without a Blob token, the page and configuration status still open; creating a project explains the missing storage setup. A public Blob store is not supported: settings include private keys. Do not expose the read-write token with a `NEXT_PUBLIC_` prefix. Use the project's existing Vercel deployment access controls for personal access.

Original files, metadata, settings, provider IDs, cache and completed output live under `clipmint/wan/v1/` in Private Blob. Preview branches use a separate `preview-<branch hash>` prefix by default. `CLIPMINT_BLOB_PREFIX` can override that namespace. File processing uses an isolated disposable `/tmp` workspace per request; it is never the source of durable state. Local operation remains unchanged. To exercise the cloud adapter outside Vercel, set `CLIPMINT_STORAGE=vercel-blob` plus the Blob token on Linux x64.

Large uploads go directly from the browser to private Blob with a short-lived token restricted to a project staging path, content types and size. The backend then downloads, fully validates/normalizes and attaches the file. Preview/download responses stream private media, including byte ranges, rather than buffering large responses in a Function. FFmpeg 7 and ffprobe Linux x64 binaries and a licensed subtitle font are included in the Wan Function bundle; no system FFmpeg installation is needed on Vercel.

There is no infinite in-process worker on Vercel. The browser invokes one bounded job step at a time, while fal renders independently in its durable provider queue. Keep the page open for polling, downloading and composition; reopening resumes stored jobs. Closing the page pauses further local processing but does not cancel a submitted fal job. Conditional Blob locks serialize writers across function instances and expire after the execution budget; a crash during a paid submit remains uncertain rather than automatically resubmitting.

A Function step has a 300-second ceiling (provider/media operations use a shorter timeout). Very large inputs/long compositions can exceed function memory, temporary disk or execution limits and report a retryable step error. Wan's short product clips are the intended workload. Native media and mocked storage/provider tests verify the serverless adapter; actual account quotas and Blob integration still require a configured deployment.

For a separate non-serverless local host, explicitly list its trusted hostname in `CLIPMINT_LOCAL_HOSTS`.

## Configuration

Open **Cấu hình AI** from the Wan route:

- fal.ai key, endpoint fal-ai/wan/v2.2-a14b/image-to-video/turbo.
- OpenAI key; defaults: vision/text gpt-4.1-mini, image edit gpt-image-1, TTS gpt-4o-mini-tts.
- Resolution, seed, acceleration, video quality, write mode and prompt expansion.
- Polling timeout/interval and concurrency (1–4 outstanding jobs, including provider jobs between polls).

Keys are saved only in backend settings.json (local file or private Blob, depending on mode). Reading settings returns configuration flags and a full mask, never the stored key. Blank key inputs preserve existing keys. Settings and data are gitignored and excluded from Next output tracing. Never prefix provider keys with NEXT_PUBLIC_.

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

Local writes use temporary-file/rename and revisions; Vercel writes use private Blob and conditional distributed locks. Running-job inputs are frozen; edits/uploads are blocked until the job finishes. Autosave persists editable choices; the project ID in the URL restores the selection.

Cache identities include content hashes, normalized prompts, model and output-affecting parameters. Final identities include source video/audio/music hashes, segment/volume settings and subtitles/narration. Keys and runtime timeout/poll settings are excluded. URL extraction downloads bytes first and caches their content hash.

Success entries are written only after media validation. Missing files are not reused. **Tạo lại** skips completed cache. Active duplicate requests are serialized/deduplicated by cross-process locks. Cache deletion is blocked while any job is queued/running/polling and only removes cache/, never project originals/outputs.

## Recovery and billing boundary

The worker scans durable jobs at startup. Immediately after fal submit returns, its request ID and status/result URLs are persisted before polling. Reloading the UI or restarting the worker polls that same ID.

Polling/download failure pauses the job. Retrying that step, or clicking create again for the same input, resumes the existing ID. It never automatically submits a replacement paid job.

If a process/connection dies during submit before an ID can be persisted, state becomes **uncertain**. No provider idempotency guarantee is assumed. Check the fal dashboard and enter its request ID to resume. For synchronous OpenAI calls interrupted by restart, the UI requires explicit acknowledgement before resending.

A PID lock prevents a second worker on the same local filesystem. Stale locks from a dead process are reclaimed at restart. Local storage is for one machine, not clustered/network filesystems. Vercel mode uses conditional Blob locks rather than PID locks.

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
    npm run test:wan-vercel

Tests use synthetic media and stubbed provider HTTP, never real keys/inference. The local smoke test forces keys empty, starts real Next/worker processes, verifies upload/settings/projects across a full restart, checks missing-key errors and old/new routes.

Verified locally: 56 tests (including 32 existing regression tests and mocked private Blob cold-start/locking/upload/cache checks), native silent/audio/subtitle MP4, job dedup/resume/ambiguous submit/concurrency, cache existence/deletion, settings masking, upload decode and URL boundaries.

Not verified without keys: actual fal generation/quota, OpenAI vision/image edits/TTS quality and real external video downloading. Browser visual/hydration automation could not run because Chromium was unavailable and its download was blocked; HTTP/API smoke and production builds were used.

## Official references checked 2026-10-06

- [Wan Turbo schema](https://fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video/turbo/api)
- [Vercel runtime filesystem](https://vercel.com/docs/functions/runtimes)
- [Vercel private Blob SDK and conditional writes](https://vercel.com/docs/vercel-blob/using-blob-sdk)
- [Vercel direct client uploads](https://vercel.com/docs/vercel-blob/client-upload)
- [fal queue lifecycle](https://fal.ai/docs/documentation/model-apis/inference/queue)
- [OpenAI image edit API](https://developers.openai.com/api/reference/resources/images)
- [OpenAI speech API](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)
- [OpenAI voices](https://developers.openai.com/api/docs/guides/text-to-speech)

## Vercel với thư mục trên máy người dùng (mặc định)

Mở `/product-video/wan` bằng Chrome/Edge trên máy tính, bấm **Chọn thư mục lưu** và cấp quyền đọc/ghi. Không cần `BLOB_READ_WRITE_TOKEN`, database hay worker local. File System Access API yêu cầu HTTPS (localhost được phép). Trình duyệt không hỗ trợ sẽ hiện hướng dẫn đổi trình duyệt; không giả vờ đã lưu vào thư mục.

Dữ liệu nằm trong `<thư mục đã chọn>/clipmint-browser/`:

- `workspace.json`: định danh thư mục cho khóa giữa các tab cùng origin.
- `settings.json`: tham số AI và key người dùng nhập (plaintext local). Không chia sẻ file này.
- `projects/<id>/project.json`, `projects/<id>/assets/`: lựa chọn, ảnh gốc và bản sao output đã tải.
- `jobs/<id>.json`: snapshot, trạng thái, request ID fal; không chứa key.
- `cache/`: metadata/result dùng lại; xóa cache không xóa project hay ảnh/media đã lưu.

IndexedDB chỉ nhớ directory handle, không thay thế lưu project trên đĩa. Reload sẽ mở lại thư mục khi quyền còn hiệu lực; nếu quyền hết, bấm **Cấp lại quyền thư mục**. Có thể mở thư mục cũ từ URL triển khai khác bằng nút chọn thư mục. Dùng một URL production ổn định: Web Locks chỉ phối hợp tab cùng origin, không khóa hai deployment/origin khác nhau cùng mở một thư mục.

Giữ tab mở khi gọi AI và xử lý media. Mở lại sẽ tiếp tục theo dõi request ID Wan đã lưu. Nếu tab đóng/mất mạng lúc submit chưa nhận ID, job chuyển sang chưa xác định; khôi phục ID từ fal dashboard, không tự submit trả phí lại. Các API AI không có queue ID cần người dùng kiểm tra provider và xác nhận trước khi gọi lại.

API `/api/wan-provider/[action]` là proxy không lưu trữ: nhận ảnh tham chiếu cần thiết (thu nhỏ JPEG tối đa 1536px/300KB mỗi ảnh), chuyển sang adapter OpenAI/fal hiện có, trả kết quả để ghi vào thư mục. Wan chỉ nhận một ảnh. Để dùng key môi trường, đặt `FAL_KEY`, `OPENAI_API_KEY` trong Vercel và redeploy; hoặc nhập key trong **Cấu hình AI** để lưu trên máy. API đọc cấu hình chỉ trả trạng thái/key đã che. Không inference khi kiểm tra cấu hình.

FFmpeg WASM chạy trong Web Worker trên máy người dùng: kiểm tra video, trích xuất audio, ghép nhiều cảnh, mix nhạc/giọng, cắt audio, phụ đề và MP4. Postinstall sao chép core JS/WASM và font DejaVu Sans sang `public/ffmpeg`. Xử lý nhiều cảnh/file lớn tốn RAM và có thể chậm; timeout hoặc thiếu asset có lỗi rõ ràng. Audio tắt xuất không có track audio. Audio dài hơn video với lựa chọn thêm cảnh sẽ dừng và yêu cầu chủ động tạo cảnh; không tự gọi Wan.

Các chế độ Node filesystem/Vercel Blob trước đây vẫn truy cập được bằng **Lưu trên server (tùy chọn)** hoặc `?storage=server`; studio cũ không thay đổi.

Kiểm tra bổ sung: filesystem giả lập có ghi bền qua instance mới, khóa/dedup, request ID sau reload, cache và đổi audio; kiểm tra dựng MP4 thật bằng chính FFmpeg WASM core (không gọi AI trả phí).
