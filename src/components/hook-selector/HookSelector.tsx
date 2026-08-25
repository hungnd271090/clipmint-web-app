"use client";

import type { Hook } from "@/lib/api/client";

const labels: Record<string, string> = { curiosity:"Tò mò", problem:"Vấn đề", result:"Kết quả", comparison:"So sánh", warning:"Lưu ý", value:"Giá trị", review:"Review" };

type Props = { hooks: Hook[]; selected: string[]; onToggle(id: string): void };

export function HookSelector({ hooks, selected, onToggle }: Props) {
  if (!hooks.length) return null;
  return <section className="panel">
    <div className="section-head"><span className="step">3</span><div><h2>Chọn hook mở đầu</h2><p>Chọn tối đa 3 hook. Mỗi hook tạo ra một video riêng.</p></div><span className="selection-count">{selected.length}/3 đã chọn</span></div>
    <div className="hook-grid">{hooks.map((hook) => {
      const active = selected.includes(hook.id);
      return <button key={hook.id} className={`hook-card ${active ? "active" : ""}`} onClick={() => onToggle(hook.id)} aria-pressed={active}>
        <span className="hook-top"><span className={`hook-type ${hook.type}`}>{labels[hook.type] ?? hook.type}</span><span className="check">{active ? "✓" : ""}</span></span>
        <strong>“{hook.text}”</strong><span>{hook.reason}</span><small>Cảnh đề xuất: {hook.recommendedScene}</small>
      </button>;
    })}</div>
  </section>;
}

