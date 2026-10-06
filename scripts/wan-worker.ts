import nextEnv from "@next/env";
import { startWorker } from "../src/server/wan/jobs";
nextEnv.loadEnvConfig(process.cwd());
const controller=new AbortController();
process.once("SIGTERM",()=>controller.abort());
process.once("SIGINT",()=>controller.abort());
console.log("ClipMint Wan worker started. Data: CLIPMINT_DATA_DIR or .clipmint-data");
startWorker(controller.signal).catch(()=>{console.error("Wan worker failed to start/read local storage. Check permissions or another running worker.");process.exitCode=1;});
