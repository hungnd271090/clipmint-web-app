"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HookSelector } from "@/components/hook-selector/HookSelector";
import { ImageAssets } from "@/components/image-assets/ImageAssets";
import { ProcessingProgress } from "@/components/processing-progress/ProcessingProgress";
import { ProductForm, type EnrichmentState } from "@/components/product-form/ProductForm";
import { VideoConfig } from "@/components/video-config/VideoConfig";
import { VideoResults } from "@/components/video-results/VideoResults";
import { VideoUpload } from "@/components/video-upload/VideoUpload";
import { extractRepresentativeFrames } from "@/features/frame-extraction/extract";
import { prepareProductAssetFrames } from "@/features/image-assets/prepare";
import { renderMotionVideo } from "@/features/video-rendering/motion";
import { renderVideo } from "@/features/video-rendering/render";
import { api, ApiError, type Hook, type ProductAnalysis, type VideoPlan } from "@/lib/api/client";
import { buildProductConcept, buildProductInfo, motionPlanForGeneratedVideo, waitForAIVideoJob } from "@/lib/ai-product-video";
import { validateEditPlan } from "@/lib/edit-plan";
import { outputFilename } from "@/lib/filename";
import { chooseOutputDirectory, saveBlob } from "@/lib/filesystem/save";
import { toggleHookSelection, validateVideoConfiguration } from "@/lib/hooks";
import { normalizedProductURL } from "@/lib/product-url";
import { readVideoMeta } from "@/lib/video";
import type { DirectoryHandleLike, ExtractedFrame, ProductAsset, ProductFormData, RenderResult, VideoConfiguration, VideoMeta } from "@/types";

const initialForm: ProductFormData = { productName: "", brand: "", productUrl: "", featuresText: "" };
const initialConfig: VideoConfiguration = { count: 1, duration: 15, voice: "coral", voiceStyle: "Tự nhiên, tự tin như người bán đang giới thiệu sản phẩm của mình", subtitleStyle: "mint", renderMode: "smart-motion" };
const initialEnrichment: EnrichmentState = { status: "idle", message: "" };

export function ClipMintApp() {
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [previewURL, setPreviewURL] = useState("");
  const [assets, setAssets] = useState<ProductAsset[]>([]);
  const assetsRef = useRef(assets);
  const [form, setForm] = useState(initialForm);
  const formRef = useRef(form);
  const [enrichment, setEnrichment] = useState(initialEnrichment);
  const [enrichmentRetry, setEnrichmentRetry] = useState(0);
  const enrichmentRequest = useRef(0);
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [analysis, setAnalysis] = useState<ProductAnalysis | null>(null);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [config, setConfig] = useState(initialConfig);
  const [directory, setDirectory] = useState<DirectoryHandleLike | null>(null);
  const [processing, setProcessing] = useState(false);
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<RenderResult[]>([]);
  const [error, setError] = useState("");

  const clearResults = useCallback(() => {
    setResults((current) => { current.forEach((result) => URL.revokeObjectURL(result.url)); return []; });
  }, []);
  const invalidateAnalysis = useCallback(() => {
    setFrames([]); setAnalysis(null); setHooks([]); setSelected([]); clearResults();
  }, [clearResults]);
  const replaceAllAssets = useCallback((next: ProductAsset[]) => {
    setAssets((current) => { current.forEach(revokeAsset); return next; });
    invalidateAnalysis();
  }, [invalidateAnalysis]);

  useEffect(() => () => { if (previewURL) URL.revokeObjectURL(previewURL); }, [previewURL]);
  useEffect(() => { formRef.current = form; }, [form]);
  useEffect(() => { assetsRef.current = assets; }, [assets]);
  useEffect(() => () => assetsRef.current.forEach(revokeAsset), []);
  useEffect(() => {
    const rawURL = form.productUrl.trim();
    const requestID = ++enrichmentRequest.current;
    if (!rawURL) return;
    const productURL = normalizedProductURL(rawURL);
    if (!productURL) return;

    const baseline = formRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setEnrichment({ status: "loading", message: "Đang tải thông tin và ảnh sản phẩm từ link…" });
      try {
        const metadata = await api.enrichProduct({ productUrl: productURL }, controller.signal);
        if (requestID !== enrichmentRequest.current) return;
        setForm((current) => {
          if (current.productUrl.trim() !== rawURL || metadata.contentType !== "product") return current;
          return {
            ...current,
            productName: current.productName === baseline.productName && metadata.productName ? metadata.productName : current.productName,
            brand: current.brand === baseline.brand && metadata.brand ? metadata.brand : current.brand,
            featuresText: current.featuresText === baseline.featuresText && metadata.features.length ? metadata.features.join("\n") : current.featuresText,
          };
        });
        if (metadata.contentType === "product") {
          const imageURLs = Array.from(new Set([...(metadata.imageUrls ?? []), metadata.imageUrl].filter(Boolean))).slice(0, 8);
          if (imageURLs.length) replaceAllAssets(imageURLs.map((remoteUrl, index) => ({
            id: crypto.randomUUID(), name: `Ảnh từ sản phẩm ${index + 1}`, source: "url" as const,
            remoteUrl, previewUrl: api.productImageURL(remoteUrl),
          })));
        }
        const warning = metadata.warnings[0];
        const reference = metadata.contentType === "social-video" || metadata.contentType === "web-page" ? {
          contentType: metadata.contentType,
          title: metadata.referenceTitle,
          author: metadata.referenceAuthor,
          thumbnailUrl: metadata.imageUrl,
          sourceUrl: metadata.resolvedUrl || metadata.productUrl,
        } : undefined;
        const imageNote = metadata.contentType === "product" && !(metadata.imageUrls?.length || metadata.imageUrl) ? " Không đọc được ảnh; hãy tải ảnh sản phẩm từ thiết bị." : "";
        setEnrichment({
          status: "success",
          message: `${warning ?? "Đã tự điền thông tin từ trang sản phẩm. Hãy kiểm tra và chỉnh sửa nếu cần."}${imageNote}`,
          reference,
        });
      } catch (reason) {
        if (controller.signal.aborted || requestID !== enrichmentRequest.current) return;
        setEnrichment({ status: "error", message: `${message(reason)} Bạn vẫn có thể nhập thông tin và tải ảnh thủ công.` });
      }
    }, 700);

    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [form.productUrl, enrichmentRetry, replaceAllAssets]);

  const selectedHooks = useMemo(() => selected.map((id) => hooks.find((hook) => hook.id === id)).filter((hook): hook is Hook => Boolean(hook)), [hooks, selected]);

  function updateForm(next: ProductFormData) {
    if (next.productName !== form.productName || next.brand !== form.brand || next.featuresText !== form.featuresText) invalidateAnalysis();
    if (next.productUrl !== form.productUrl) {
      replaceAllAssets([]);
      const productURL = next.productUrl.trim();
      if (!productURL) setEnrichment(initialEnrichment);
      else if (!normalizedProductURL(productURL)) setEnrichment({ status: "invalid", message: "Link phải là địa chỉ HTTP hoặc HTTPS hợp lệ." });
      else setEnrichment({ status: "loading", message: "Đang chuẩn bị tải thông tin sản phẩm…" });
    }
    setForm(next);
  }

  async function selectVideo(next: File) {
    const nextMeta = await readVideoMeta(next);
    setFile(next); setMeta(nextMeta); invalidateAnalysis();
    setPreviewURL(URL.createObjectURL(next)); setError("");
  }

  function addAssets(files: File[]) {
    setAssets((current) => [...current, ...files.map(localAsset)].slice(0, 8));
    invalidateAnalysis(); setError("");
  }

  function replaceAsset(id: string, next: File) {
    setAssets((current) => current.map((asset) => {
      if (asset.id !== id) return asset;
      revokeAsset(asset);
      return { ...localAsset(next), id };
    }));
    invalidateAnalysis(); setError("");
  }

  function removeAsset(id: string) {
    setAssets((current) => current.filter((asset) => {
      if (asset.id === id) revokeAsset(asset);
      return asset.id !== id;
    }));
    invalidateAnalysis();
  }

  async function analyze() {
    if (!file && !assets.length) { setError("Hãy tải video hoặc thêm ít nhất một ảnh sản phẩm trước khi phân tích."); return; }
    setProcessing(true); setProgress(0.04); setError("");
    try {
      let extracted: ExtractedFrame[] = [];
      if (file && meta) {
        setStage("Đang trích xuất các frame đại diện trên thiết bị");
        extracted = frames.length ? frames : await extractRepresentativeFrames(file, meta.duration);
        setFrames(extracted);
      } else {
        setStage("Đang nén ảnh sản phẩm để AI nhận diện từng ảnh");
        extracted = frames.length === assets.length ? frames : await prepareProductAssetFrames(assets, api.fetchProductImage);
        setFrames(extracted);
      }
      setProgress(0.13); setStage(file ? "AI đang phân tích sản phẩm và các cảnh quay" : "AI đang phân tích thông tin và từng ảnh sản phẩm");
      const productAnalysis = await api.analyzeProduct({
        analysisMode: file ? "video" : "product-only",
        productName: form.productName.trim(), brand: form.brand.trim(), productUrl: form.productUrl.trim(),
        referenceTitle: enrichment.reference?.title ?? "", referenceAuthor: enrichment.reference?.author ?? "",
        features: form.featuresText.split(/\n|,/).map((item) => item.trim()).filter(Boolean), frames: extracted,
      });
      setAnalysis(productAnalysis); setProgress(0.2); setStage("AI đang viết các hook phù hợp");
      const response = await api.generateHooks({ productName: form.productName.trim(), brand: form.brand.trim(), analysis: productAnalysis });
      setHooks(response.hooks); setSelected(response.hooks.slice(0, config.count).map((hook) => hook.id)); setProgress(1);
    } catch (reason) { setError(message(reason)); }
    finally { setProcessing(false); }
  }

  async function generateAll() {
    if (!analysis) { setError("Hãy phân tích sản phẩm trước."); return; }
    if (!file && !assets.length) { setError("Hãy thêm ít nhất một ảnh sản phẩm để dựng video."); return; }
    const invalid = validateVideoConfiguration(selectedHooks.length, config.count);
    if (invalid) { setError(invalid); return; }
    clearResults(); setProcessing(true); setError(""); setProgress(0.18);
    try {
      const nextResults: RenderResult[] = [];
      for (let index = 0; index < selectedHooks.length; index++) {
        const result = await createOne(selectedHooks[index], index, (value, label) => {
          const base = index / selectedHooks.length;
          setProgress(Math.min(0.99, base + value / selectedHooks.length)); setStage(`Video ${index + 1}/${selectedHooks.length} · ${label}`);
        });
        nextResults.push(result); setResults([...nextResults]);
      }
      setProgress(1); setStage("Đã xuất MP4 thành công");
    } catch (reason) { setError(message(reason)); }
    finally { setProcessing(false); }
  }

  async function createOne(hook: Hook, index: number, report: (progress: number, label: string) => void): Promise<RenderResult> {
    if (!analysis) throw new Error("Thiếu dữ liệu phân tích để dựng video.");
    report(0.08, file ? "Đang tạo kịch bản và edit plan" : "Đang sáng tạo kịch bản và motion plan");

    let blob: Blob;
    let duration: number;
    if (file && meta) {
      const plan = await api.generateVideoPlan({
        selectedHook: hook, productAnalysis: analysis, availableFrameTimestamps: frames.map((frame) => frame.timestampSeconds),
        sourceDurationSeconds: meta.duration, requestedDurationSeconds: config.duration, voiceStyle: config.voiceStyle, subtitleStyle: config.subtitleStyle,
      });
      assertPlan(plan, config.duration, meta.duration);
      report(0.24, "Đang tạo giọng đọc AI");
      const voice = await api.generateVoice({ text: plan.voiceScript, voice: config.voice, style: config.voiceStyle, targetDurationSeconds: config.duration });
      report(0.38, "Đang khởi động FFmpeg WebAssembly");
      blob = await renderVideo(file, voice, plan, config.subtitleStyle, (value, label) => report(0.38 + value * 0.62, label));
      duration = plan.durationSeconds;
    } else {
      if (!assets.length) throw new Error("Cần ít nhất một ảnh sản phẩm để dựng video.");
      const plan = await api.generateMotionVideoPlan({
        selectedHook: hook, productAnalysis: analysis, assetCount: assets.length,
        requestedDurationSeconds: config.duration, voiceStyle: config.voiceStyle, subtitleStyle: config.subtitleStyle,
      });
      if (config.renderMode === "ai-product") {
        const productImages = frames.length === assets.length ? frames : await prepareProductAssetFrames(assets, api.fetchProductImage);
        if (productImages !== frames) setFrames(productImages);
        report(0.16, "Đang gửi ảnh nén để tạo AI Product Video");
        const started = await api.createAIProductVideoJob({
          productName: form.productName.trim(), productInfo: buildProductInfo(form.productName, analysis),
          userConcept: buildProductConcept(plan), durationSeconds: 15, ratio: "720:1280", productImages,
        });
        const completed = await waitForAIVideoJob(started.id, api.getAIProductVideoJob, {
          onUpdate: (job) => report(0.2 + Math.min(0.38, (job.progress ?? 0.15) * 0.38), job.status === "queued" ? "AI Product Video đang xếp hàng" : "AI Product Video đang tạo chuyển động"),
        });
        report(0.6, "Đang tải video AI về trình duyệt");
        const generatedBlob = await api.fetchGeneratedVideo(completed.outputUrls[0]);
        const generatedFile = new File([generatedBlob], "ai-product-video.mp4", { type: "video/mp4" });
        const generatedMeta = await readVideoMeta(generatedFile);
        const generatedPlan = motionPlanForGeneratedVideo(plan, generatedMeta.duration);
        assertPlan(generatedPlan, config.duration, generatedMeta.duration);
        report(0.66, "Đang tạo giọng đọc AI");
        const voice = await api.generateVoice({ text: generatedPlan.voiceScript, voice: config.voice, style: config.voiceStyle, targetDurationSeconds: config.duration });
        report(0.73, "Đang ghép voice và phụ đề trên trình duyệt");
        blob = await renderVideo(generatedFile, voice, generatedPlan, config.subtitleStyle, (value, label) => report(0.73 + value * 0.27, label));
        duration = generatedPlan.durationSeconds;
      } else {
        report(0.24, "Đang tạo giọng đọc AI");
        const voice = await api.generateVoice({ text: plan.voiceScript, voice: config.voice, style: config.voiceStyle, targetDurationSeconds: config.duration });
        report(0.38, "Đang tải ảnh và khởi động Smart Motion 2.5D");
        blob = await renderMotionVideo(assets, voice, plan, config.subtitleStyle, (value, label) => report(0.38 + value * 0.62, label));
        duration = plan.durationSeconds;
      }
    }
    const filename = outputFilename(form.productName, index);
    return { id: `${hook.id}-${Date.now()}`, hookText: hook.text, duration, resolution: "1080 × 1920", filename, url: URL.createObjectURL(blob), blob };
  }

  async function regenerate(result: RenderResult) {
    const hook = hooks.find((item) => item.text === result.hookText);
    if (!hook) return;
    setProcessing(true); setError("");
    try {
      const index = results.indexOf(result);
      const replacement = await createOne(hook, Math.max(0, index), (value, label) => { setProgress(value); setStage(`Dựng lại · ${label}`); });
      URL.revokeObjectURL(result.url);
      setResults((current) => current.map((item) => item.id === result.id ? replacement : item));
    } catch (reason) { setError(message(reason)); }
    finally { setProcessing(false); }
  }

  async function chooseDirectory() {
    try { setDirectory(await chooseOutputDirectory()); }
    catch (reason) { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(message(reason)); }
  }

  async function save(result: RenderResult) {
    try { await saveBlob(result.blob, result.filename, directory); }
    catch (reason) { setError(message(reason)); }
  }

  return <>
    <header className="topbar"><a className="brand" href="#top" aria-label="ClipMint AI"><span className="brand-mark">C</span><span>ClipMint <b>AI</b></span></a><nav><a href="#how">Cách hoạt động</a><a href="#privacy">Quyền riêng tư</a><span className="beta">MVP beta</span></nav></header>
    <main id="top">
      <section className="hero"><div className="eyebrow"><span>✦</span> AI VIDEO AFFILIATE STUDIO</div><h1>Biến video hoặc ảnh thành<br/><em>video bán hàng cuốn hút</em></h1><p>Tải video thô hoặc chỉ dán link sản phẩm. ClipMint gợi ý hook, sáng tạo kịch bản và dựng video ngay trên máy.</p><div className="trust-row"><span>✓ Chỉ gửi frame/ảnh nén cho AI phân tích</span><span>✓ Tối đa 3 video</span><span>✓ Xuất MP4 dọc 1080p</span></div></section>
      <div className="workspace">
        <div className="main-column">
          {error && <div className="error-banner"><span>!</span><p>{error}</p><button onClick={() => setError("")} aria-label="Đóng">×</button></div>}
          <VideoUpload file={file} meta={meta} previewURL={previewURL} onSelect={selectVideo}/>
          <ProductForm value={form} enrichment={enrichment} onChange={updateForm} onRetryEnrichment={() => setEnrichmentRetry((value) => value + 1)} onAnalyze={analyze} disabled={processing}/>
          <ImageAssets assets={assets} required={!file} disabled={processing} onAdd={addAssets} onReplace={replaceAsset} onRemove={removeAsset}/>
          <HookSelector hooks={hooks} selected={selected} onToggle={(id) => setSelected((current) => toggleHookSelection(current, id))}/>
          {hooks.length > 0 && <VideoConfig value={config} imageModeAvailable={!file} onChange={setConfig} directory={directory} onChooseDirectory={() => void chooseDirectory()} onGenerate={() => void generateAll()} disabled={processing}/>}
          <ProcessingProgress active={processing} stage={stage} progress={progress}/>
          <VideoResults results={results} onSave={(result) => void save(result)} onRegenerate={(result) => void regenerate(result)} regenerating={processing}/>
        </div>
        <aside id="privacy"><div className="privacy-card"><span>◉</span><h3>Kiểm soát dữ liệu hình ảnh</h3><p>Video gốc và ảnh gốc luôn ở trình duyệt. Smart Motion dựng hoàn toàn local; khi bạn chọn AI Product Video, chỉ ảnh WebP đã nén được gửi tới Runway để tạo cảnh quay.</p></div><div className="tips-card"><h3>Để video tốt hơn</h3><ul><li>Dùng 3–6 ảnh rõ nét</li><li>Có ảnh tổng thể và cận cảnh</li><li>Ưu tiên ảnh dọc hoặc vuông</li><li>Kiểm tra lại mọi thông tin AI điền</li></ul></div></aside>
      </div>
      <section className="how" id="how"><span>3 bước đơn giản</span><h2>Từ link hoặc video đến nội dung sẵn sàng đăng</h2><div><article><i>01</i><h3>Nhập nguồn</h3><p>Tải video hoặc dán link; thay và bổ sung ảnh nếu cần.</p></article><article><i>02</i><h3>Chọn ý tưởng</h3><p>AI phân tích thông tin sản phẩm và đề xuất nhiều hook.</p></article><article><i>03</i><h3>Chọn cách dựng</h3><p>Dùng Smart Motion local hoặc AI Product Video, sau đó ghép voice và phụ đề trên máy.</p></article></div></section>
    </main>
    <footer><a className="brand" href="#top"><span className="brand-mark">C</span><span>ClipMint AI</span></a><p>Video affiliate thông minh, riêng tư và dễ dùng.</p><small>© 2026 ClipMint AI · Giọng đọc trong video được tạo bởi AI.</small></footer>
  </>;
}

function localAsset(file: File): ProductAsset {
  return { id: crypto.randomUUID(), name: file.name, source: "upload", file, previewUrl: URL.createObjectURL(file) };
}

function revokeAsset(asset: ProductAsset) {
  if (asset.source === "upload") URL.revokeObjectURL(asset.previewUrl);
}

function assertPlan(plan: VideoPlan, requestedDuration: number, sourceDuration: number) {
  const errors = validateEditPlan(plan, requestedDuration, sourceDuration);
  if (errors.length) throw new Error(`Edit plan không an toàn: ${errors.join(" ")}`);
}

function message(reason: unknown): string {
  if (reason instanceof ApiError) return `${reason.message}${reason.requestId ? ` · Mã yêu cầu: ${reason.requestId}` : ""}`;
  return reason instanceof Error ? reason.message : "Đã có lỗi xảy ra. Vui lòng thử lại.";
}
