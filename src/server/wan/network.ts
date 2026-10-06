import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { isIP } from "node:net";
import { WanError } from "./storage";
export function publicIP(ip: string) {
  if (isIP(ip) === 6) {
    if (ip.toLowerCase().startsWith("::ffff:")) return publicIP(ip.slice(7));
    // Only global-unicast IPv6, reject transition/documentation ranges.
    return /^[23][0-9a-f]{3}:/i.test(ip) && !/^(2001:db8:|2001:0:|2002:)/i.test(ip);
  }
  const [a,b] = ip.split(".").map(Number);
  return isIP(ip) === 4 && !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
}
// Resolve, validate and pin DNS for each redirect; never send provider credentials.
export async function downloadURL(raw: string, maxBytes = 300 * 1024 * 1024, redirects = 0): Promise<Buffer> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new WanError("URL không hợp lệ."); }
  if (!["https:","http:"].includes(url.protocol) || url.username || url.password || redirects > 4 ||
    (url.port && !["80","443"].includes(url.port))) throw new WanError("URL công khai HTTP(S), không có tài khoản, port 80/443.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some(a => !publicIP(a.address))) throw new WanError("URL trỏ tới mạng nội bộ hoặc địa chỉ không an toàn.");
  const address = addresses[0];
  return new Promise<Buffer>((resolve,reject) => {
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      lookup: (_hostname, _options, cb) => cb(null, address.address, address.family),
      headers: { Accept: "*/*", "User-Agent": "ClipMint/1.0" }, timeout: 120_000,
    }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); downloadURL(new URL(res.headers.location, url).href, maxBytes, redirects + 1).then(resolve,reject); return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new WanError("Không tải được URL (HTTP " + res.statusCode + "). Hãy upload file nếu website yêu cầu đăng nhập hoặc chặn download.")); return; }
      if (Number(res.headers["content-length"]) > maxBytes) { res.destroy(); reject(new WanError("File vượt giới hạn download.")); return; }
      const chunks: Buffer[] = []; let total = 0;
      res.on("data", (chunk: Buffer) => { total += chunk.length; if (total > maxBytes) { res.destroy(); reject(new WanError("File vượt giới hạn download.")); } else chunks.push(chunk); });
      res.on("end", () => total ? resolve(Buffer.concat(chunks)) : reject(new WanError("File download trống.")));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new WanError("Download quá thời gian. Hãy thử upload file.")));
    req.on("error", reject); req.end();
  });
}
