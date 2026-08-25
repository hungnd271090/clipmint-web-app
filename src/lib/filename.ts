export function outputFilename(productName: string, index: number): string {
  const slug = productName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "san-pham";
  return `clipmint-${slug}-${String(index + 1).padStart(2, "0")}.mp4`;
}

