// Local real-process smoke test. Explicitly remove provider keys; no inference.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import sharp from "sharp";
const require=createRequire(import.meta.url);
const root=await mkdtemp(path.join(os.tmpdir(),"clipmint-smoke-"));
const env={...process.env,CLIPMINT_DATA_DIR:root,FAL_KEY:"",OPENAI_API_KEY:"",NEXT_TELEMETRY_DISABLED:"1"};
const port=Number(process.env.WAN_SMOKE_PORT || 4183);
const base="http://127.0.0.1:"+port;
const children=[];
function startWorker() {
  const child=spawn(process.execPath,["--import","tsx","scripts/wan-worker.ts"],{env,stdio:["ignore","pipe","pipe"]});
  children.push(child);return child;
}
async function stop(child) {
  if(child.exitCode!==null)return;
  const done=new Promise(resolve=>child.once("exit",resolve));child.kill("SIGTERM");await done;
}
async function api(endpoint,method="GET",body) {
  const r=await fetch(base+"/api/wan/"+endpoint,{method,body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body),
    headers:body instanceof FormData || body===undefined?undefined:{"Content-Type":"application/json"}});
  const data=await r.json();if(!r.ok)throw new Error(data.error || String(r.status));return data;
}
try {
  const server=spawn(process.execPath,[require.resolve("next/dist/bin/next"),"start","--hostname","127.0.0.1","--port",String(port)],{env,stdio:["ignore","pipe","pipe"]});
  children.push(server);let logs="";
  server.stderr.on("data",d=>{logs=(logs+String(d)).slice(-4000);});
  for(let i=0;i<120;i++){
    try {await api("settings");break;} catch {if(i===119)throw new Error("Server did not start: "+logs);await new Promise(r=>setTimeout(r,250));}
  }
  let worker=startWorker();
  await new Promise(r=>setTimeout(r,600));
  if(!(await api("settings")).worker.running)throw new Error("Worker not running.");
  const {project}=await api("projects","POST",{});
  const form=new FormData();form.set("kind","image");
  form.set("file",new File([await sharp({create:{width:128,height:128,channels:3,background:"#16c79a"}}).png().toBuffer()],"product.png",{type:"image/png"}));
  const {project:p}=await api("projects/"+project.id+"/assets","POST",form);
  await api("projects/"+p.id,"PATCH",{...p,name:"Local smoke product",mode:"manual",scenes:[{id:"scene1",name:"Studio",prompt:"White studio",motion:"Slow push in",original:true,sourceId:p.primaryId}]});
  await api("settings","PUT",{pollSeconds:3});
  await stop(worker);await stop(server);
  const restarted=spawn(process.execPath,[require.resolve("next/dist/bin/next"),"start","--hostname","127.0.0.1","--port",String(port)],{env,stdio:["ignore","pipe","pipe"]});
  children.push(restarted);worker=startWorker();
  for(let i=0;i<120;i++){
    try {await api("settings");break;} catch {if(i===119)throw new Error("Restart failed.");await new Promise(r=>setTimeout(r,250));}
  }
  const restored=await api("projects/"+p.id);
  if(restored.project.name!=="Local smoke product" || restored.project.scenes.length!==1)throw new Error("Project not restored after full process restart.");
  if((await api("settings")).settings.pollSeconds!==3)throw new Error("Settings not restored.");
  const test=await api("settings/test","POST",{});
  if(!test.message.includes("Không tạo"))throw new Error("Config test not safe.");
  const missing=await fetch(base+"/api/wan/projects/"+p.id+"/jobs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"video",sceneId:"scene1"})});
  if(missing.status!==400)throw new Error("Missing-key state incorrect.");
  for(const route of ["/","/meta-ai","/product-video/wan"]){
    const r=await fetch(base+route);if(!r.ok)throw new Error("Route failed: "+route);
  }
  console.log("PASS: real Next API + worker startup/restart, project/settings persistence, upload, missing-key state, safe configuration check, original routes.");
} catch(e) {console.error(e.message);process.exitCode=1;}
finally {for(const child of children)await stop(child);await rm(root,{recursive:true,force:true});}
