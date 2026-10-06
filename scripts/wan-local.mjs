import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url);
const production=process.argv.includes("--production");
const children=[
  spawn(process.execPath,["--import","tsx","scripts/wan-worker.ts"],{stdio:"inherit",shell:false}),
  spawn(process.execPath,[require.resolve("next/dist/bin/next"),production?"start":"dev","--hostname","127.0.0.1"],{stdio:"inherit",shell:false}),
];
let stopping=false;
function stop(code=0) { if(stopping)return;stopping=true;process.exitCode=code;children.forEach(c=>c.kill("SIGTERM")); }
children.forEach(c=>{c.on("error",()=>stop(1));c.on("exit",code=>stop(code||0));});
process.once("SIGINT",()=>stop());process.once("SIGTERM",()=>stop());
