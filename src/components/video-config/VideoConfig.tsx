"use client";

import type { DirectoryHandleLike, VideoConfiguration } from "@/types";

type Props = { value: VideoConfiguration; directory: DirectoryHandleLike | null; disabled: boolean; onChange(value: VideoConfiguration): void; onChooseDirectory(): void; onGenerate(): void };

export function VideoConfig({ value, directory, disabled, onChange, onChooseDirectory, onGenerate }: Props) {
  return <section className="panel">
    <div className="section-head"><span className="step">4</span><div><h2>Cấu hình video</h2><p>Tinh chỉnh đầu ra trước khi ClipMint dựng video trên máy.</p></div></div>
    <div className="config-grid">
      <label><span>Số lượng video</span><select value={value.count} onChange={(e) => onChange({ ...value, count: Number(e.target.value) as 1|2|3 })}><option value="1">1 video</option><option value="2">2 video</option><option value="3">3 video</option></select></label>
      <label><span>Thời lượng</span><select value={value.duration} onChange={(e) => onChange({ ...value, duration: Number(e.target.value) as 15|20|30 })}><option value="15">15 giây</option><option value="20">20 giây</option><option value="30">30 giây</option></select></label>
      <label><span>Giọng đọc AI</span><select value={value.voice} onChange={(e) => onChange({ ...value, voice: e.target.value as VideoConfiguration["voice"] })}><option value="coral">Coral · năng động</option><option value="marin">Marin · tự nhiên</option><option value="cedar">Cedar · ấm áp</option><option value="nova">Nova · rõ ràng</option></select></label>
      <label><span>Kiểu phụ đề</span><select value={value.subtitleStyle} onChange={(e) => onChange({ ...value, subtitleStyle: e.target.value as VideoConfiguration["subtitleStyle"] })}><option value="mint">Mint nổi bật</option><option value="bold">Vàng đậm</option><option value="minimal">Trắng tối giản</option></select></label>
      <label className="wide"><span>Phong cách giọng đọc</span><input value={value.voiceStyle} onChange={(e) => onChange({ ...value, voiceStyle: e.target.value })} /></label>
      <div className="directory-field wide"><span>Thư mục lưu</span><div><button className="button secondary" onClick={onChooseDirectory}>Chọn thư mục</button><p>{directory ? `📁 ${directory.name}` : "Chưa chọn · sẽ tải xuống bằng trình duyệt"}</p></div></div>
    </div>
    <p className="ai-disclosure">ⓘ Giọng đọc được tạo bởi AI, không phải giọng người thật.</p>
    <button className="button primary generate-button" disabled={disabled} onClick={onGenerate}>Tạo video với ClipMint <span>→</span></button>
  </section>;
}

