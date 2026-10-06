import { describe,expect,it } from "vitest";
import { downloadURL,publicIP } from "./network";
describe("local media URL boundary",()=>{
  it("rejects loopback, private, link-local and IPv6 mapped private addresses",()=>{
    for(const address of ["127.0.0.1","10.0.0.1","172.16.1.2","192.168.0.1","169.254.169.254","100.64.0.1","::1","fc00::1","::ffff:127.0.0.1"])expect(publicIP(address)).toBe(false);
    expect(publicIP("8.8.8.8")).toBe(true);
  });
  it("rejects file URLs and internal downloads before opening a connection",async()=>{
    await expect(downloadURL("file:///etc/passwd")).rejects.toThrow("URL công khai");
    await expect(downloadURL("http://127.0.0.1/private")).rejects.toThrow("mạng nội bộ");
  });
});
