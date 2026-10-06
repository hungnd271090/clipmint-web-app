"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";

const OPENAI_IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits";
const DEFAULT_META_AI_URL = "https://www.facebook.com/messages/t/156025504001094";
const OPENAI_KEY_STORAGE = "clipmint:openai-key";
const META_AI_URL_STORAGE = "clipmint:meta-ai-url";

const backgroundTemplates = [
  {
    id: "luxury-store",
    label: "Shop cao cấp",
    prompt:
      "Đặt sản phẩm trong một cửa hàng cao cấp, ánh sáng studio mềm, nền sang trọng, chiều sâu tự nhiên, bố cục quảng cáo dọc 9:16. Giữ nguyên chính xác thiết kế, màu sắc, logo và tỉ lệ của sản phẩm.",
  },
  {
    id: "clean-studio",
    label: "Studio tối giản",
    prompt:
      "Tạo ảnh quảng cáo studio tối giản với nền sạch, ánh sáng mềm và bóng đổ chân thực. Sản phẩm là chủ thể chính, sắc nét, cao cấp. Giữ nguyên chính xác thiết kế, màu sắc, logo và tỉ lệ của sản phẩm.",
  },
  {
    id: "lifestyle",
    label: "Lifestyle tự nhiên",
    prompt:
      "Đặt sản phẩm vào một bối cảnh lifestyle tự nhiên phù hợp với công dụng của sản phẩm, ánh sáng đời thực đẹp, độ sâu trường ảnh nhẹ, cảm giác video TikTok cao cấp. Giữ nguyên chính xác thiết kế, màu sắc, logo và tỉ lệ của sản phẩm.",
  },
  {
    id: "premium-table",
    label: "Bàn trưng bày",
    prompt:
      "Đặt sản phẩm trên bàn trưng bày cao cấp với vật liệu sang trọng, ánh sáng điện ảnh, background gọn gàng và có chiều sâu. Hình ảnh sắc nét, photorealistic. Giữ nguyên chính xác thiết kế, màu sắc, logo và tỉ lệ của sản phẩm.",
  },
];

const videoTemplates = [
  {
    id: "slow-orbit",
    label: "Camera orbit",
    prompt:
      "Animate this exact product image into a short realistic product video. Keep the product design, color, logo, texture and proportions unchanged. Use a slow cinematic camera orbit around the product with subtle parallax and realistic lighting. Vertical social media ad, natural motion, no text added to the product.",
  },
  {
    id: "push-in",
    label: "Hero push-in",
    prompt:
      "Create a short premium product advertisement from this image. Keep the exact product unchanged. Start with a gentle camera push-in, add small natural background motion and realistic light reflections. Make the product remain sharp and stable. Vertical 9:16 style, cinematic but realistic.",
  },
  {
    id: "hand-demo",
    label: "Người cầm thử",
    prompt:
      "Create a short realistic product demo video from this image. Preserve the exact product appearance. A natural human hand gently picks up and presents the product to camera without changing its shape, color, logo or details. Smooth camera movement, realistic fingers and physics, vertical social media style.",
  },
  {
    id: "usage-demo",
    label: "Dùng sản phẩm",
    prompt:
      "Turn this image into a short realistic usage demo. Keep the exact product identity and all visual details unchanged. Show a natural person using or wearing the product in a way appropriate to the product category. Smooth motion, realistic anatomy, product stays consistent, vertical TikTok/Reels advertising style.",
  },
];

type OpenAIImageResponse = {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string };
};

export function MetaAIProductFlow() {
  const [apiKey, setApiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(false);
  const [metaAIUrl, setMetaAIUrl] = useState(DEFAULT_META_AI_URL);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourcePreview, setSourcePreview] = useState("");
  const [imagePrompt, setImagePrompt] = useState(backgroundTemplates[0].prompt);
  const [generatedImage, setGeneratedImage] = useState("");
  const [generatedMime, setGeneratedMime] = useState("image/png");
  const [videoPrompt, setVideoPrompt] = useState(videoTemplates[0].prompt);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const savedKey = window.sessionStorage.getItem(OPENAI_KEY_STORAGE) ?? "";
    const savedMetaUrl = window.localStorage.getItem(META_AI_URL_STORAGE) ?? DEFAULT_META_AI_URL;
    if (savedKey) {
      setApiKey(savedKey);
      setRememberKey(true);
    }
    setMetaAIUrl(savedMetaUrl);
  }, []);

  useEffect(() => {
    return () => {
      if (sourcePreview) URL.revokeObjectURL(sourcePreview);
    };
  }, [sourcePreview]);

  const canGenerate = useMemo(
    () => Boolean(apiKey.trim() && sourceFile && imagePrompt.trim() && !loading),
    [apiKey, sourceFile, imagePrompt, loading],
  );

  function onSelectImage(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0];
    if (!next) return;
    if (!next.type.startsWith("image/")) {
      setMessage("File đã chọn không phải hình ảnh.");
      return;
    }
    if (sourcePreview) URL.revokeObjectURL(sourcePreview);
    setSourceFile(next);
    setSourcePreview(URL.createObjectURL(next));
    setGeneratedImage("");
    setMessage("");
  }

  function updateKey(value: string) {
    setApiKey(value);
    if (rememberKey) window.sessionStorage.setItem(OPENAI_KEY_STORAGE, value);
  }

  function toggleRememberKey(enabled: boolean) {
    setRememberKey(enabled);
    if (enabled) window.sessionStorage.setItem(OPENAI_KEY_STORAGE, apiKey);
    else window.sessionStorage.removeItem(OPENAI_KEY_STORAGE);
  }

  async function generateImage() {
    if (!sourceFile) return;
    setLoading(true);
    setMessage("Đang gửi ảnh trực tiếp từ trình duyệt tới OpenAI…");
    try {
      if (rememberKey) window.sessionStorage.setItem(OPENAI_KEY_STORAGE, apiKey.trim());

      const body = new FormData();
      body.append("model", "gpt-image-2");
      body.append("image", sourceFile, sourceFile.name);
      body.append(
        "prompt",
        `${imagePrompt.trim()}\n\nImportant: preserve the exact product identity and important visual details from the input image. Do not invent a different product. Produce a sharp photorealistic commercial image suitable as the first frame of an image-to-video generation workflow.`,
      );
      body.append("size", "1024x1536");
      body.append("quality", "high");

      const response = await fetch(OPENAI_IMAGE_EDIT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        body,
      });
      const payload = (await response.json()) as OpenAIImageResponse;
      if (!response.ok) throw new Error(payload.error?.message || `OpenAI trả về HTTP ${response.status}`);

      const result = payload.data?.[0];
      if (result?.b64_json) {
        setGeneratedMime("image/png");
        setGeneratedImage(`data:image/png;base64,${result.b64_json}`);
      } else if (result?.url) {
        const imageResponse = await fetch(result.url);
        if (!imageResponse.ok) throw new Error("Không tải được ảnh kết quả từ OpenAI.");
        const blob = await imageResponse.blob();
        setGeneratedMime(blob.type || "image/png");
        setGeneratedImage(await blobToDataURL(blob));
      } else {
        throw new Error("OpenAI không trả về ảnh kết quả.");
      }
      setMessage("Đã tạo ảnh mới. Hãy kiểm tra sản phẩm trước khi chuyển sang bước Meta AI.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể tạo ảnh.");
    } finally {
      setLoading(false);
    }
  }

  function downloadGeneratedImage() {
    if (!generatedImage) return;
    const extension = generatedMime.includes("jpeg") ? "jpg" : "png";
    const link = document.createElement("a");
    link.href = generatedImage;
    link.download = `clipmint-meta-source-${Date.now()}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function copyVideoPrompt() {
    await navigator.clipboard.writeText(videoPrompt.trim());
    setMessage("Đã copy prompt video vào clipboard.");
  }

  async function prepareForMetaAI() {
    if (!generatedImage) {
      setMessage("Hãy tạo và duyệt ảnh trước.");
      return;
    }
    await navigator.clipboard.writeText(videoPrompt.trim());
    downloadGeneratedImage();
    window.localStorage.setItem(META_AI_URL_STORAGE, metaAIUrl.trim() || DEFAULT_META_AI_URL);
    window.open(metaAIUrl.trim() || DEFAULT_META_AI_URL, "_blank", "noopener,noreferrer");
    setMessage("Đã tải ảnh xuống, copy prompt và mở Meta AI. Trong Messenger: đính kèm ảnh vừa tải → Ctrl+V prompt → Send.");
  }

  return (
    <main className="min-h-screen bg-[#f5fbf8] px-4 py-8 text-[#11231f] md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-700">
              ClipMint · Meta AI Flow
            </div>
            <h1 className="text-3xl font-black tracking-tight md:text-5xl">Ảnh sản phẩm → OpenAI → Meta AI</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 md:text-base">
              MVP chạy hoàn toàn trên FE. OpenAI key chỉ được dùng trong browser; không đi qua ClipMint backend.
            </p>
          </div>
          <a href="/" className="text-sm font-semibold text-emerald-700 hover:underline">← ClipMint hiện tại</a>
        </div>

        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          <strong>Lưu ý tạm thời:</strong> nhập API key trực tiếp trên FE sẽ làm key có thể nhìn thấy trong DevTools/network của chính trình duyệt. Chỉ nên dùng cho máy cá nhân/MVP. Nếu bật “giữ key”, key chỉ được lưu trong <code>sessionStorage</code> và mất khi session browser kết thúc.
        </div>

        <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
          <h2 className="text-xl font-extrabold">1. OpenAI API key</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">OpenAI API key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => updateKey(event.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-emerald-500"
              />
            </label>
            <label className="flex items-center gap-2 pb-3 text-sm text-slate-600">
              <input type="checkbox" checked={rememberKey} onChange={(event) => toggleRememberKey(event.target.checked)} />
              Giữ key trong session này
            </label>
          </div>
        </section>

        <section className="mb-6 grid gap-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2 md:p-7">
          <div>
            <h2 className="text-xl font-extrabold">2. Upload ảnh sản phẩm</h2>
            <label className="mt-4 flex min-h-72 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center hover:border-emerald-400">
              {sourcePreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sourcePreview} alt="Ảnh sản phẩm gốc" className="max-h-96 max-w-full rounded-xl object-contain" />
              ) : (
                <div>
                  <div className="text-3xl">＋</div>
                  <div className="mt-2 font-bold">Chọn ảnh sản phẩm</div>
                  <div className="mt-1 text-sm text-slate-500">PNG / JPG / WEBP</div>
                </div>
              )}
              <input type="file" accept="image/*" className="hidden" onChange={onSelectImage} />
            </label>
          </div>

          <div>
            <h2 className="text-xl font-extrabold">3. Chọn bối cảnh / nhập prompt</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {backgroundTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setImagePrompt(template.prompt)}
                  className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
                >
                  {template.label}
                </button>
              ))}
            </div>
            <textarea
              value={imagePrompt}
              onChange={(event) => setImagePrompt(event.target.value)}
              rows={10}
              className="mt-4 w-full resize-y rounded-2xl border border-slate-300 p-4 text-sm leading-6 outline-none focus:border-emerald-500"
              placeholder="Ví dụ: đặt sản phẩm trong shop sang trọng, ánh sáng studio…"
            />
            <button
              type="button"
              disabled={!canGenerate}
              onClick={generateImage}
              className="mt-4 w-full rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? "Đang tạo ảnh…" : "Tạo ảnh mới bằng OpenAI"}
            </button>
          </div>
        </section>

        <section className="mb-6 grid gap-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2 md:p-7">
          <div>
            <h2 className="text-xl font-extrabold">4. Duyệt ảnh kết quả</h2>
            <div className="mt-4 flex min-h-80 items-center justify-center overflow-hidden rounded-2xl bg-slate-100 p-4">
              {generatedImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={generatedImage} alt="Ảnh đã tạo bởi OpenAI" className="max-h-[600px] max-w-full rounded-xl object-contain" />
              ) : (
                <p className="max-w-xs text-center text-sm leading-6 text-slate-500">Ảnh mới sẽ xuất hiện ở đây. Nếu sản phẩm bị sai chi tiết, hãy chỉnh prompt rồi tạo lại trước khi gửi Meta AI.</p>
              )}
            </div>
            {generatedImage && (
              <button type="button" onClick={downloadGeneratedImage} className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 font-bold hover:bg-slate-50">
                Tải ảnh này
              </button>
            )}
          </div>

          <div>
            <h2 className="text-xl font-extrabold">5. Chọn prompt tạo video</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {videoTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setVideoPrompt(template.prompt)}
                  className="rounded-full border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-100"
                >
                  {template.label}
                </button>
              ))}
            </div>
            <textarea
              value={videoPrompt}
              onChange={(event) => setVideoPrompt(event.target.value)}
              rows={11}
              className="mt-4 w-full resize-y rounded-2xl border border-slate-300 p-4 text-sm leading-6 outline-none focus:border-violet-500"
            />
            <button type="button" onClick={copyVideoPrompt} className="mt-3 w-full rounded-xl border border-violet-300 px-4 py-3 font-bold text-violet-800 hover:bg-violet-50">
              Copy prompt video
            </button>

            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-semibold">Meta AI Messenger URL</span>
              <input
                value={metaAIUrl}
                onChange={(event) => setMetaAIUrl(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-violet-500"
              />
            </label>

            <button
              type="button"
              disabled={!generatedImage || !videoPrompt.trim()}
              onClick={prepareForMetaAI}
              className="mt-4 w-full rounded-xl bg-violet-600 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Chuẩn bị & mở Meta AI
            </button>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              Browser không được phép tự gắn file vào tab Messenger khác. Nút này sẽ tải ảnh, copy prompt và mở đúng chat Meta AI; bạn chỉ cần attach ảnh vừa tải, paste prompt và Send.
            </p>
          </div>
        </section>

        {message && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium leading-6 text-emerald-900">{message}</div>}
      </div>
    </main>
  );
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Không đọc được ảnh kết quả."));
    reader.readAsDataURL(blob);
  });
}
