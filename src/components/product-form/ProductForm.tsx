"use client";

import type { ProductFormData } from "@/types";

export type EnrichmentState = {
  status: "idle" | "loading" | "success" | "error" | "invalid";
  message: string;
  reference?: {
    contentType: "social-video" | "web-page";
    title: string;
    author: string;
    thumbnailUrl: string;
    sourceUrl: string;
  };
};

type Props = {
  value: ProductFormData;
  disabled: boolean;
  enrichment: EnrichmentState;
  onChange(value: ProductFormData): void;
  onRetryEnrichment(): void;
  onAnalyze(): void;
};

export function ProductForm({ value, disabled, enrichment, onChange, onRetryEnrichment, onAnalyze }: Props) {
  const field = (key: keyof ProductFormData) => ({ value: value[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [key]: event.target.value }) });
  return <section className="panel">
    <div className="section-head"><span className="step">2</span><div><h2>Thông tin sản phẩm</h2><p>Dán link để tự điền hoặc nhập thủ công. Bạn luôn có thể chỉnh sửa trước khi AI phân tích.</p></div></div>
    <div className="form-grid">
      <label className="wide"><span>Link sản phẩm <em>Không bắt buộc</em></span><input type="url" inputMode="url" placeholder="https://..." {...field("productUrl")} /></label>
      {enrichment.status !== "idle" && <div className={`url-enrichment ${enrichment.status}`} role="status">
        {enrichment.status === "loading" && <i aria-hidden="true"/>}
        <span>{enrichment.message}</span>
        {enrichment.status === "error" && <button type="button" onClick={onRetryEnrichment}>Tải lại</button>}
      </div>}
      {enrichment.reference && <div className="link-reference">
        {enrichment.reference.thumbnailUrl && <div
          className="link-reference-thumb"
          role="img"
          aria-label="Ảnh xem trước"
          style={{ backgroundImage: `url(${JSON.stringify(enrichment.reference.thumbnailUrl)})` }}
        />}
        <div>
          <small>{enrichment.reference.contentType === "social-video" ? "Video TikTok tham khảo" : "Trang tham khảo"}</small>
          <strong>{enrichment.reference.title || "Không đọc được tiêu đề"}</strong>
          {enrichment.reference.author && <span>{enrichment.reference.author}</span>}
          <a href={enrichment.reference.sourceUrl} target="_blank" rel="noreferrer">Mở nguồn ↗</a>
        </div>
      </div>}
      <label><span>Tên sản phẩm <b>*</b></span><input placeholder="Ví dụ: Máy hút bụi mini cầm tay M1" {...field("productName")} /></label>
      <label><span>Thương hiệu <em>Không bắt buộc</em></span><input placeholder="Mint Home" {...field("brand")} /></label>
      <label className="wide"><span>Điểm nổi bật và trải nghiệm thực tế</span><textarea rows={5} placeholder={"Mỗi ý một dòng, ví dụ:\nCó 3 đầu hút\nDùng tốt cho bàn làm việc và ô tô\nPin sử dụng khoảng 25 phút"} {...field("featuresText")} /></label>
    </div>
    <button className="button primary analyze-button" disabled={disabled || enrichment.status === "loading" || enrichment.status === "invalid" || !value.productName.trim()} onClick={onAnalyze}><span>✦</span> Phân tích và gợi ý hook</button>
  </section>;
}
