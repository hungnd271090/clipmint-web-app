import { beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { composition, type MediaInfo } from "./command";
import type { Project } from "../types";
interface Core {exec(...args:string[]):number;ffprobe(...args:string[]):number;reset():void;FS:{readFile(path:string):Uint8Array;writeFile(path:string,bytes:Uint8Array):void;mkdir(path:string):void};setLogger(fn:(v:{message:string})=>void):void}
const require=createRequire(import.meta.url);let core:Core;
const info:MediaInfo={duration:0.5,video:true,audio:false,width:64,height:64};
const p:Project={id:"test",name:"",features:"",message:"",primaryId:"",mode:"manual",suggestions:[],assets:[],scenes:[{id:"s",name:"",prompt:"",motion:"",original:true,sourceId:""}],revision:0,createdAt:"",updatedAt:"",ratio:"1:1",resolution:"480p",audio:{enabled:false,source:"tts",audioId:"",musicId:"",url:"",text:"",voice:"coral",language:"vi",speed:1,start:0,end:null,volume:1,musicVolume:0.1,subtitles:false,overflow:"trim"}};
function exec(args:string[]){core.reset();expect(core.exec(...args)).toBe(0);}
function probe(path:string){core.reset();core.ffprobe("-v","error","-show_streams","-show_format","-of","json",path,"-o","probe.json");return JSON.parse(new TextDecoder().decode(core.FS.readFile("probe.json")));}
beforeAll(async()=>{vi.stubGlobal("self",{location:{href:"http://localhost/ffmpeg-core.js"}});const factory=require("@ffmpeg/core") as (o:{wasmBinary:Buffer})=>Promise<Core>;core=await factory({wasmBinary:readFileSync(require.resolve("@ffmpeg/core/wasm"))});exec(["-f","lavfi","-i","color=c=red:s=64x64:d=0.5","-c:v","libx264","-f","mp4","video-temp.mp4"]);core.FS.writeFile("video-0",core.FS.readFile("video-temp.mp4"));exec(["-f","lavfi","-i","sine=frequency=440:duration=1","-c:a","aac","-f","ipod","voice"]);core.FS.writeFile("music",core.FS.readFile("voice"));core.FS.mkdir("fonts");core.FS.writeFile("fonts/DejaVuSans.ttf",readFileSync("src/server/wan/fonts/DejaVuSans.ttf"));},20000);
describe("real FFmpeg WASM composition",()=>{
  it("exports silent MP4 and probes output with the actual browser core",()=>{const plan=composition(p,[info]);exec(plan.args);const result=probe("output.mp4");expect(result.streams.map((s:{codec_type:string})=>s.codec_type)).toEqual(["video"]);expect(result.streams[0].width).toBe(480);},20000);
  it("mixes trimmed narration and music, burns Vietnamese subtitles",()=>{const project={...p,audio:{...p.audio,enabled:true,subtitles:true,start:0.1,end:0.8}};const plan=composition(project,[info],{info:{...info,duration:1,audio:true,video:false},narration:"Sản phẩm của bạn"},true);core.FS.writeFile("captions.srt",new TextEncoder().encode(plan.captions));exec(plan.args);const result=probe("output.mp4");expect(result.streams.some((s:{codec_type:string})=>s.codec_type==="audio")).toBe(true);expect(Number(result.format.duration)).toBeLessThan(0.7);},20000);
  it("refuses implicit extension for longer audio",()=>{expect(()=>composition({...p,audio:{...p.audio,enabled:true,overflow:"extend"}},[info],{info:{...info,duration:3,audio:true}})).toThrow("Chủ động");});
});
