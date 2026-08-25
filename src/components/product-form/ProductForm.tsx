"use client";

import type { ProductFormData } from "@/types";

type Props = { value: ProductFormData; disabled: boolean; onChange(value: ProductFormData): void; onAnalyze(): void };

export function ProductForm({ value, disabled, onChange, onAnalyze }: Props) {
  const field = (key: keyof ProductFormData) => ({ value: value[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [key]: event.target.value }) });
  return <section className="panel">
    <div className="section-head"><span className="step">2</span><div><h2>Thông tin sản phẩm</h2><p>AI chỉ sử dụng dữ liệu bạn cung cấp và hình ảnh nhìn thấy.</p></div></div>
    <div className="form-grid">
      <label className="wide"><span>Tên sản phẩm <b>*</b></span><input placeholder="Ví dụ: Máy hút bụi mini cầm tay M1" {...field("productName")} /></label>
      <label><span>Thương hiệu <em>Không bắt buộc</em></span><input placeholder="Mint Home" {...field("brand")} /></label>
      <label><span>Link sản phẩm <em>Không bắt buộc</em></span><input type="url" placeholder="https://..." {...field("productUrl")} /></label>
      <label className="wide"><span>Điểm nổi bật và trải nghiệm thực tế</span><textarea rows={5} placeholder={"Mỗi ý một dòng, ví dụ:\nCó 3 đầu hút\nDùng tốt cho bàn làm việc và ô tô\nPin sử dụng khoảng 25 phút"} {...field("featuresText")} /></label>
    </div>
    <button className="button primary analyze-button" disabled={disabled || !value.productName.trim()} onClick={onAnalyze}><span>✦</span> Phân tích và gợi ý hook</button>
  </section>;
}

