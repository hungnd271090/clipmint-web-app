import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { GET, POST } from "@/app/api/wan-provider/[action]/route";
import { defaults } from "@/features/wan/defaults";
import type { Project } from "@/features/wan/types";
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const request=(action:string,body:unknown,origin="https://clipmint.example")=>POST(new Request("https://clipmint.example/api/wan-provider/"+action,{method:"POST",headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify(body)}),{params:Promise.resolve({action})});
it("reads masked environment settings and validates without Blob or inference",async()=>{vi.stubEnv("VERCEL","1");vi.stubEnv("BLOB_READ_WRITE_TOKEN","");vi.stubEnv("FAL_KEY","environment-secret");const fetch=vi.fn();vi.stubGlobal("fetch",fetch);const result=await(await GET()).json();expect(result.settings.falConfigured).toBe(true);expect(JSON.stringify(result)).not.toContain("environment-secret");const test=await request("test",{settings:defaults});expect(test.status).toBe(200);expect(fetch).not.toHaveBeenCalled();});
it("rejects cross-origin mutation",async()=>{expect((await request("test",{},"https://other.example")).status).toBe(403);});
it("submits exactly one decoded browser reference with correct MIME and no disk read",async()=>{
  const jpeg=await sharp({create:{width:64,height:64,channels:3,background:"red"}}).jpeg().toBuffer();
  const fetch=vi.fn(async(url:URL|string,options:RequestInit)=>{void url;void options;return Response.json({request_id:"fal-id",status_url:"https://queue.fal.run/fal-ai/wan/requests/fal-id/status",response_url:"https://queue.fal.run/fal-ai/wan/requests/fal-id"});});vi.stubGlobal("fetch",fetch);
  const p={name:"",features:"",message:"",ratio:"9:16",resolution:"720p",primaryId:"a",assets:[{id:"a",mime:"image/png",kind:"image",file:"never-read-this"}],scenes:[{id:"s",sourceId:"a",original:true,prompt:"studio",motion:"slow"}],audio:{text:"",voice:"coral",language:"vi",speed:1}} as unknown as Project;
  const result=await request("submit",{settings:{...defaults,falKey:"test-secret"},project:p,sceneId:"s",images:[{id:"a",data:"data:image/jpeg;base64,"+jpeg.toString("base64")}]});expect(result.status).toBe(200);expect((await result.json()).requestId).toBe("fal-id");const input=JSON.parse(fetch.mock.calls[0][1].body as string);expect(input.image_url).toMatch(/^data:image\/jpeg;base64,/);expect(input.duration).toBeUndefined();expect(input.image_urls).toBeUndefined();
});
it("polls only the registered queue namespace and never submits",async()=>{const fetch=vi.fn(async(url:URL|string,options:RequestInit)=>{void url;void options;return Response.json({status:"IN_QUEUE"});});vi.stubGlobal("fetch",fetch);expect((await request("poll",{settings:{...defaults,falKey:"test-secret"},requestId:"fal-id"})).status).toBe(200);expect(fetch.mock.calls[0][0]).toBeInstanceOf(URL);expect(String(fetch.mock.calls[0][0])).toBe("https://queue.fal.run/fal-ai/wan/requests/fal-id/status");expect(fetch.mock.calls[0][1].method).toBe("GET");expect((await request("poll",{requestId:"../external"})).status).toBe(400);});
