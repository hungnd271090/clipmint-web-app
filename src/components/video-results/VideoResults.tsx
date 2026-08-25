"use client";

import type { RenderResult } from "@/types";

type Props = { results: RenderResult[]; onSave(result: RenderResult): void; onRegenerate(result: RenderResult): void; regenerating: boolean };

export function VideoResults({ results, onSave, onRegenerate, regenerating }: Props) {
  if (!results.length) return null;
  return <section className="panel results-panel">
    <div className="section-head"><span className="result-mark">✓</span><div><h2>Video đã sẵn sàng</h2><p>Xem trước, lưu MP4 hoặc dựng lại từng phiên bản.</p></div></div>
    <div className="results-grid">{results.map((result, index) => <article className="result-card" key={result.id}>
      <video src={result.url} controls playsInline />
      <div className="result-body"><small>PHIÊN BẢN {index + 1}</small><strong>{result.hookText}</strong><p>{result.duration}s · {result.resolution} · MP4</p><div><button className="button primary" onClick={() => onSave(result)}>Lưu MP4</button><button className="button secondary" disabled={regenerating} onClick={() => onRegenerate(result)}>↻ Dựng lại</button></div></div>
    </article>)}</div>
  </section>;
}

