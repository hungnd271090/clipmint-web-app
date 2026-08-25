"use client";

const steps = ["Phân tích frame", "Tạo kịch bản", "Tạo giọng đọc", "Lập kế hoạch dựng", "Dựng video", "Xuất MP4"];

type Props = { active: boolean; stage: string; progress: number };

export function ProcessingProgress({ active, stage, progress }: Props) {
  if (!active) return null;
  const current = Math.min(steps.length - 1, Math.floor(progress * steps.length));
  return <section className="panel processing-panel">
    <div className="processing-title"><div className="spinner"/><div><h2>ClipMint đang xử lý</h2><p>{stage}</p></div><strong>{Math.round(progress * 100)}%</strong></div>
    <div className="progress-track"><span style={{ width: `${Math.max(4, progress * 100)}%` }} /></div>
    <div className="process-steps">{steps.map((item, index) => <div key={item} className={index < current ? "done" : index === current ? "current" : ""}><i>{index < current ? "✓" : index + 1}</i><span>{item}</span></div>)}</div>
  </section>;
}

