"use client";

import { useRef, useState } from "react";
import type { ProductAsset } from "@/types";

type Props = {
  assets: ProductAsset[];
  required: boolean;
  disabled: boolean;
  onAdd(files: File[]): void;
  onReplace(id: string, file: File): void;
  onRemove(id: string): void;
};

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function ImageAssets({ assets, required, disabled, onAdd, onReplace, onRemove }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  function validFiles(list: FileList | null): File[] {
    const files = Array.from(list ?? []);
    const invalid = files.find((file) => !allowedTypes.has(file.type) || file.size === 0 || file.size > 8 * 1024 * 1024);
    if (invalid) {
      setError("Chỉ hỗ trợ JPEG, PNG hoặc WebP, tối đa 8 MB mỗi ảnh.");
      return [];
    }
    setError("");
    return files.slice(0, Math.max(0, 8 - assets.length));
  }

  return <section className={`panel asset-panel ${required && !assets.length ? "asset-required" : ""}`}>
    <div className="section-head">
      <span className="step">Ảnh</span>
      <div><h2>Ảnh dùng để dựng video</h2><p>Ảnh đọc từ link chỉ là gợi ý ban đầu. Bạn có thể thay, xóa hoặc tải thêm ảnh trước khi tạo video.</p></div>
      <span className="status-chip">{assets.length}/8 ảnh</span>
    </div>

    {assets.length > 0 ? <div className="asset-grid">{assets.map((asset, index) => <article className="asset-card" key={asset.id}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset.previewUrl} alt={`Ảnh sản phẩm ${index + 1}`} />
      <div><strong>{asset.name}</strong><small>{asset.source === "url" ? "Đọc từ link sản phẩm" : "Tải từ thiết bị"}</small></div>
      <div className="asset-actions">
        <label className="button secondary">Thay ảnh<input hidden disabled={disabled} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => {
          const file = validFiles(event.target.files)[0];
          if (file) onReplace(asset.id, file);
          event.currentTarget.value = "";
        }}/></label>
        <button className="button danger" disabled={disabled} type="button" onClick={() => onRemove(asset.id)}>Xóa</button>
      </div>
    </article>)}</div> : <button type="button" className="asset-empty" disabled={disabled} onClick={() => input.current?.click()}>
      <span>＋</span><strong>Chưa có ảnh sản phẩm</strong><small>{required ? "Hãy tải lên ít nhất một ảnh để tạo video không cần video gốc." : "Bạn có thể tải ảnh để tạo video từ ảnh."}</small>
    </button>}

    <div className="asset-footer">
      <button className="button secondary" type="button" disabled={disabled || assets.length >= 8} onClick={() => input.current?.click()}>＋ Thêm ảnh</button>
      <small>Ảnh gốc dựng tại trình duyệt; bản WebP nén được gửi cho AI để khớp nội dung.</small>
    </div>
    {error && <p className="form-error">{error}</p>}
    <input ref={input} hidden multiple type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => {
      const files = validFiles(event.target.files);
      if (files.length) onAdd(files);
      event.currentTarget.value = "";
    }}/>
  </section>;
}
