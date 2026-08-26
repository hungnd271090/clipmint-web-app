"use client";

import { useRef, useState } from "react";
import { formatBytes, validateVideoFile } from "@/lib/video";
import type { VideoMeta } from "@/types";

type Props = { file: File | null; meta: VideoMeta | null; previewURL: string; onSelect(file: File): Promise<void> };

export function VideoUpload({ file, meta, previewURL, onSelect }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  async function accept(next?: File) {
    if (!next) return;
    const errors = validateVideoFile(next);
    if (errors.length) { setError(errors[0]); return; }
    setError("");
    try { await onSelect(next); } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể mở video."); }
  }

  if (file && meta) {
    return <section className="panel upload-complete">
      <div className="section-head"><span className="step">1</span><div><h2>Video gốc <small>(không bắt buộc)</small></h2><p>Video chỉ được xử lý trên thiết bị của bạn.</p></div><span className="status-chip">Đã sẵn sàng</span></div>
      <div className="video-summary">
        <video src={previewURL} controls playsInline preload="metadata" />
        <div className="video-details">
          <strong>{meta.name}</strong>
          <dl>
            <div><dt>Dung lượng</dt><dd>{formatBytes(meta.size)}</dd></div>
            <div><dt>Thời lượng</dt><dd>{meta.duration.toFixed(1)} giây</dd></div>
            <div><dt>Độ phân giải</dt><dd>{meta.width} × {meta.height}</dd></div>
          </dl>
          {meta.warnings.map((warning) => <p className="warning" key={warning}>⚠ {warning}</p>)}
          <button className="button secondary" onClick={() => input.current?.click()}>Thay video</button>
        </div>
      </div>
      <input ref={input} hidden type="file" accept="video/mp4,video/quicktime,.mp4,.mov" onChange={(event) => accept(event.target.files?.[0])} />
    </section>;
  }

  return <section className="panel">
    <div className="section-head"><span className="step">1</span><div><h2>Tải video gốc <small>(không bắt buộc)</small></h2><p>MP4 hoặc MOV · hoặc bỏ qua để tạo video từ ảnh sản phẩm</p></div></div>
    <div
      className={`dropzone ${dragging ? "dragging" : ""}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); void accept(event.dataTransfer.files[0]); }}
      onClick={() => input.current?.click()}
      role="button" tabIndex={0}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") input.current?.click(); }}
    >
      <div className="upload-icon">↥</div><strong>Kéo thả video vào đây</strong><span>hoặc bấm để chọn tệp trên máy</span><small>Không có video? Dán link sản phẩm ở bước tiếp theo.</small>
    </div>
    {error && <p className="form-error">{error}</p>}
    <input ref={input} hidden type="file" accept="video/mp4,video/quicktime,.mp4,.mov" onChange={(event) => void accept(event.target.files?.[0])} />
  </section>;
}
