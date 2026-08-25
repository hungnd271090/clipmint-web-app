"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HookSelector } from "@/components/hook-selector/HookSelector";
import { ProcessingProgress } from "@/components/processing-progress/ProcessingProgress";
import { ProductForm, type EnrichmentState } from "@/components/product-form/ProductForm";
import { VideoConfig } from "@/components/video-config/VideoConfig";
import { VideoResults } from "@/components/video-results/VideoResults";
import { VideoUpload } from "@/components/video-upload/VideoUpload";
import { extractRepresentativeFrames } from "@/features/frame-extraction/extract";
import { renderVideo } from "@/features/video-rendering/render";
import { api, ApiError, type Hook, type ProductAnalysis, type VideoPlan } from "@/lib/api/client";
import { validateEditPlan } from "@/lib/edit-plan";
import { outputFilename } from "@/lib/filename";
import { chooseOutputDirectory, saveBlob } from "@/lib/filesystem/save";
import { toggleHookSelection, validateVideoConfiguration } from "@/lib/hooks";
import { normalizedProductURL } from "@/lib/product-url";
import { readVideoMeta } from "@/lib/video";
import type { DirectoryHandleLike, ExtractedFrame, ProductFormData, RenderResult, VideoConfiguration, VideoMeta } from "@/types";

const initialForm: ProductFormData = { productName: "", brand: "", productUrl: "", featuresText: "" };
const initialConfig: VideoConfiguration = { count: 1, duration: 15, voice: "coral", voiceStyle: "Tự nhiên như một người dùng đang review sản phẩm", subtitleStyle: "mint" };
const initialEnrichment: EnrichmentState = { status: "idle", message: "" };

export function ClipMintApp() {
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [previewURL, setPreviewURL] = useState("");
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

  useEffect(() => () => { if (previewURL) URL.revokeObjectURL(previewURL); }, [previewURL]);
  useEffect(() => { formRef.current = form; }, [form]);
  useEffect(() => {
    const rawURL = form.productUrl.trim();
    const requestID = ++enrichmentRequest.current;
    if (!rawURL) return;
    const productURL = normalizedProductURL(rawURL);
    if (!productURL) return;

    const baseline = formRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setEnrichment({ status: "loading", message: "Đang tải thông tin sản phẩm từ link…" });
      try {
        const metadata = await api.enrichProduct({ productUrl: productURL }, controller.signal);
        if (requestID !== enrichmentRequest.current) return;
        setForm((current) => {
          if (current.productUrl.trim() !== rawURL) return current;
          return {
            ...current,
            productName: current.productName === baseline.productName && metadata.productName ? metadata.productName : current.productName,
            brand: current.brand === baseline.brand && metadata.brand ? metadata.brand : current.brand,
            featuresText: current.featuresText === baseline.featuresText && metadata.features.length ? metadata.features.join("\n") : current.featuresText,
          };
        });
        const warning = metadata.warnings[0];
        setEnrichment({
          status: "success",
          message: warning ? `Đã tự điền thông tin. ${warning}` : "Đã tự điền thông tin từ trang sản phẩm. Hãy kiểm tra và chỉnh sửa nếu cần.",
        });
      } catch (reason) {
        if (controller.signal.aborted || requestID !== enrichmentRequest.current) return;
        setEnrichment({ status: "error", message: `${message(reason)} Bạn vẫn có thể nhập các trường bên dưới thủ công.` });
      }
    }, 700);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [form.productUrl, enrichmentRetry]);
  const selectedHooks = useMemo(() => selected.map((id) => hooks.find((hook) => hook.id === id)).filter((hook): hook is Hook => Boolean(hook)), [hooks, selected]);

  function updateForm(next: ProductFormData) {
    if (next.productUrl !== form.productUrl) {
      const productURL = next.productUrl.trim();
      if (!productURL) setEnrichment(initialEnrichment);
      else if (!normalizedProductURL(productURL)) setEnrichment({ status: "invalid", message: "Link phải là địa chỉ HTTP hoặc HTTPS hợp lệ." });
      else setEnrichment({ status: "loading", message: "Đang chuẩn bị tải thông tin sản phẩm…" });
    }
    setForm(next);
  }

  async function selectVideo(next: File) {
    const nextMeta = await readVideoMeta(next);
    setFile(next); setMeta(nextMeta); setFrames([]); setAnalysis(null); setHooks([]); setSelected([]); clearResults();
    setPreviewURL(URL.createObjectURL(next)); setError("");
  }

  async function analyze() {
    if (!file || !meta) { setError("Hãy chọn video trước khi phân tích."); return; }
    setProcessing(true); setStage("Đang trích xuất các frame đại diện trên thiết bị"); setProgress(0.04); setError("");
    try {
      const extracted = frames.length ? frames : await extractRepresentativeFrames(file, meta.duration);
      setFrames(extracted); setProgress(0.13); setStage("AI đang phân tích sản phẩm và các cảnh quay");
      const productAnalysis = await api.analyzeProduct({
        productName: form.productName.trim(), brand: form.brand.trim(), productUrl: form.productUrl.trim(),
        features: form.featuresText.split(/\n|,/).map((item) => item.trim()).filter(Boolean), frames: extracted,
      });
      setAnalysis(productAnalysis); setProgress(0.2); setStage("AI đang viết các hook phù hợp");
      const response = await api.generateHooks({ productName: form.productName.trim(), brand: form.brand.trim(), analysis: productAnalysis });
      setHooks(response.hooks); setSelected(response.hooks.slice(0, config.count).map((hook) => hook.id)); setProgress(1);
    } catch (reason) { setError(message(reason)); }
    finally { setProcessing(false); }
  }

  async function generateAll() {
    if (!file || !meta || !analysis) { setError("Hãy phân tích sản phẩm trước."); return; }
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
    if (!file || !meta || !analysis) throw new Error("Thiếu dữ liệu để dựng video.");
    report(0.08, "Đang tạo kịch bản và edit plan");
    const plan = await api.generateVideoPlan({
      selectedHook: hook, productAnalysis: analysis, availableFrameTimestamps: frames.map((frame) => frame.timestampSeconds),
      sourceDurationSeconds: meta.duration, requestedDurationSeconds: config.duration, voiceStyle: config.voiceStyle, subtitleStyle: config.subtitleStyle,
    });
    assertPlan(plan, config.duration, meta.duration);
    report(0.24, "Đang tạo giọng đọc AI");
    const voice = await api.generateVoice({ text: plan.voiceScript, voice: config.voice, style: config.voiceStyle, targetDurationSeconds: config.duration });
    report(0.38, "Đang khởi động FFmpeg WebAssembly");
    const blob = await renderVideo(file, voice, plan, config.subtitleStyle, (renderProgress, label) => report(0.38 + renderProgress * 0.62, label));
    const filename = outputFilename(form.productName, index);
    return { id: `${hook.id}-${Date.now()}`, hookText: hook.text, duration: plan.durationSeconds, resolution: "1080 × 1920", filename, url: URL.createObjectURL(blob), blob };
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

  function clearResults() { results.forEach((result) => URL.revokeObjectURL(result.url)); setResults([]); }

  return <>
    <header className="topbar"><a className="brand" href="#top" aria-label="ClipMint AI"><span className="brand-mark">C</span><span>ClipMint <b>AI</b></span></a><nav><a href="#how">Cách hoạt động</a><a href="#privacy">Quyền riêng tư</a><span className="beta">MVP beta</span></nav></header>
    <main id="top">
      <section className="hero"><div className="eyebrow"><span>✦</span> AI VIDEO AFFILIATE STUDIO</div><h1>Biến video thô thành<br/><em>video bán hàng cuốn hút</em></h1><p>Tải video sản phẩm, chọn hook và để AI lập kịch bản. Video được dựng ngay trên máy — nhanh, riêng tư và sẵn sàng đăng.</p><div className="trust-row"><span>✓ Không tải video gốc lên server</span><span>✓ Tối đa 3 video</span><span>✓ Xuất MP4 dọc 1080p</span></div></section>
      <div className="workspace">
        <div className="main-column">
          {error && <div className="error-banner"><span>!</span><p>{error}</p><button onClick={() => setError("")} aria-label="Đóng">×</button></div>}
          <VideoUpload file={file} meta={meta} previewURL={previewURL} onSelect={selectVideo}/>
          <ProductForm value={form} enrichment={enrichment} onChange={updateForm} onRetryEnrichment={() => setEnrichmentRetry((value) => value + 1)} onAnalyze={analyze} disabled={!file || processing}/>
          <HookSelector hooks={hooks} selected={selected} onToggle={(id) => setSelected((current) => toggleHookSelection(current, id))}/>
          {hooks.length > 0 && <VideoConfig value={config} onChange={setConfig} directory={directory} onChooseDirectory={() => void chooseDirectory()} onGenerate={() => void generateAll()} disabled={processing}/>} 
          <ProcessingProgress active={processing} stage={stage} progress={progress}/>
          <VideoResults results={results} onSave={(result) => void save(result)} onRegenerate={(result) => void regenerate(result)} regenerating={processing}/>
        </div>
        <aside id="privacy"><div className="privacy-card"><span>◉</span><h3>Video gốc luôn ở trên máy</h3><p>ClipMint chỉ gửi các frame đại diện đã nén để AI phân tích. Toàn bộ quá trình cắt, ghép và xuất MP4 diễn ra trong trình duyệt.</p></div><div className="tips-card"><h3>Để video tốt hơn</h3><ul><li>Quay dọc 9:16, đủ sáng</li><li>Có cảnh cận sản phẩm</li><li>Cho thấy cách sử dụng thật</li><li>Mô tả đúng trải nghiệm</li></ul></div></aside>
      </div>
      <section className="how" id="how"><span>3 bước đơn giản</span><h2>Từ video thô đến nội dung sẵn sàng đăng</h2><div><article><i>01</i><h3>Tải và mô tả</h3><p>Chọn video trên máy, nhập sản phẩm và trải nghiệm thật.</p></article><article><i>02</i><h3>Chọn ý tưởng</h3><p>AI phân tích frame và đề xuất nhiều hook phù hợp.</p></article><article><i>03</i><h3>Dựng trên máy</h3><p>FFmpeg WebAssembly ghép cảnh, giọng đọc và phụ đề.</p></article></div></section>
    </main>
    <footer><a className="brand" href="#top"><span className="brand-mark">C</span><span>ClipMint AI</span></a><p>Video affiliate thông minh, riêng tư và dễ dùng.</p><small>© 2026 ClipMint AI · Giọng đọc trong video được tạo bởi AI.</small></footer>
  </>;
}

function assertPlan(plan: VideoPlan, requestedDuration: number, sourceDuration: number) {
  const errors = validateEditPlan(plan, requestedDuration, sourceDuration);
  if (errors.length) throw new Error(`Edit plan không an toàn: ${errors.join(" ")}`);
}

function message(reason: unknown): string {
  if (reason instanceof ApiError) return `${reason.message}${reason.requestId ? ` · Mã yêu cầu: ${reason.requestId}` : ""}`;
  return reason instanceof Error ? reason.message : "Đã có lỗi xảy ra. Vui lòng thử lại.";
}
