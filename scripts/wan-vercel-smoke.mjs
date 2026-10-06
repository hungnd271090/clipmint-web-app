// Real production route smoke in serverless mode. No Blob/provider credentials.
import {spawn} from "node:child_process";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const port=Number(process.env.WAN_VERCEL_SMOKE_PORT || 4184);
const env={...process.env,VERCEL:"1",CLIPMINT_STORAGE:"vercel-blob",BLOB_READ_WRITE_TOKEN:"",FAL_KEY:"",OPENAI_API_KEY:"",NEXT_TELEMETRY_DISABLED:"1"};
const child=spawn(process.execPath,[require.resolve("next/dist/bin/next"),"start","--hostname","127.0.0.1","--port",String(port)],{env,stdio:["ignore","pipe","pipe"]});
let logs="";child.stderr.on("data",d=>{logs=(logs+String(d)).slice(-4000);});
const base="http://127.0.0.1:"+port;
try{
  let config;
  for(let i=0;i<120;i++){
    try{const r=await fetch(base+"/api/wan/settings",{headers:{host:"clipmint.vercel.app"}});if(!r.ok)throw new Error(String(r.status));config=await r.json();break;}
    catch{if(i===119)throw new Error("Vercel-mode startup failed: "+logs);await new Promise(r=>setTimeout(r,250));}
  }
  if(config.storage.mode!=="vercel-blob" || config.storage.configured || config.worker.mode!=="serverless")throw new Error("Incorrect Vercel runtime status.");
  if(!config.dependencies.tools.every(t=>t.available))throw new Error("Bundled media binaries unavailable.");
  const blocked=await fetch(base+"/api/wan/projects",{method:"POST",headers:{"content-type":"application/json",host:"clipmint.vercel.app"},body:"{}"});
  if(blocked.status!==503 || !(await blocked.json()).error.includes("Blob store Private"))throw new Error("Missing storage must explain setup, not reject Vercel hostname.");
  for(const route of ["/","/meta-ai","/product-video/wan"]){if(!(await fetch(base+route)).ok)throw new Error("Route failed: "+route);}
  console.log("PASS: real production serverless routes, public hostname, bundled FFmpeg/ffprobe, missing Blob setup, original routes. No paid API calls.");
}catch(e){console.error(e.message);process.exitCode=1;}
finally{if(child.exitCode===null){const exited=new Promise(resolve=>child.once("exit",resolve));child.kill("SIGTERM");await exited;}}
