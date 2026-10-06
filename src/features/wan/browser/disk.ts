export interface DiskFile {kind:"file";name:string;getFile():Promise<File>;createWritable():Promise<{write(data:Blob|string):Promise<void>;close():Promise<void>;abort():Promise<void>}>}
export interface DiskDirectory {kind:"directory";name:string;getDirectoryHandle(name:string,options?:{create:boolean}):Promise<DiskDirectory>;getFileHandle(name:string,options?:{create:boolean}):Promise<DiskFile>;entries():AsyncIterableIterator<[string,DiskDirectory|DiskFile]>;removeEntry(name:string,options?:{recursive:boolean}):Promise<void>;queryPermission(options:{mode:"readwrite"}):Promise<PermissionState>;requestPermission(options:{mode:"readwrite"}):Promise<PermissionState>}
export const folderSupported=()=>typeof window!=="undefined" && "showDirectoryPicker" in window && !!navigator.locks;
async function handleMemory(value?:DiskDirectory){
  return new Promise<DiskDirectory|undefined>((resolve,reject)=>{
    const open=indexedDB.open("clipmint-directory",1);open.onupgradeneeded=()=>open.result.createObjectStore("handles");open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{const db=open.result;const tx=db.transaction("handles",value?"readwrite":"readonly");const request=value?tx.objectStore("handles").put(value,"wan"):tx.objectStore("handles").get("wan");let result:DiskDirectory|undefined;request.onsuccess=()=>{if(!value)result=request.result;};tx.oncomplete=()=>{db.close();resolve(value||result);};tx.onerror=()=>{db.close();reject(tx.error);};};
  });
}
export class DirectoryStore {
  root?:DiskDirectory;selected?:DiskDirectory;namespace="";
  async restore(){const h=await handleMemory().catch(()=>undefined);this.selected=h;if(h && await h.queryPermission({mode:"readwrite"})==="granted")await this.connect(h);}
  async pick(reconnect=false){
    if(!folderSupported())throw new Error("Chọn thư mục cần Chrome hoặc Edge trên máy tính, HTTPS và Web Locks. Mở trang bằng trình duyệt này.");
    // Both permission prompts are invoked directly from the user's click, before asynchronous work.
    const pickerWindow=(window as unknown as {showDirectoryPicker(o:{mode:"readwrite";id:string}):Promise<DiskDirectory>});
    const h=reconnect && this.selected?this.selected:await pickerWindow.showDirectoryPicker({mode:"readwrite",id:"clipmint-wan"});
    if(await h.requestPermission({mode:"readwrite"})!=="granted")throw new Error("Chưa được cấp quyền ghi thư mục.");
    await this.connect(h);await handleMemory(h);
  }
  async connect(h:DiskDirectory){
    this.selected=h;this.root=await h.getDirectoryHandle("clipmint-browser",{create:true});
    await navigator.locks.request("clipmint-initialize-"+h.name,{mode:"exclusive"},async()=>{
      let meta=await this.json<{id:string}>("workspace.json");
      if(!meta){meta={id:crypto.randomUUID()};await this.writeJSON("workspace.json",meta);}this.namespace=meta.id;
    });
  }
  private async parent(path:string,create=false){
    if(!this.root)throw new Error("Hãy chọn hoặc cấp lại quyền thư mục lưu trên máy.");
    const parts=path.split("/");if(parts.some(p=>!p || !/^[a-zA-Z0-9_.-]+$/.test(p) || p==="." || p===".."))throw new Error("Đường dẫn dữ liệu không hợp lệ.");
    let dir=this.root;for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part,{create});return {dir,name:parts.at(-1)!};
  }
  async read(path:string){const {dir,name}=await this.parent(path);return (await dir.getFileHandle(name)).getFile();}
  async write(path:string,data:Blob|string){const {dir,name}=await this.parent(path,true);const w=await (await dir.getFileHandle(name,{create:true})).createWritable();try{await w.write(data);await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}}
  async json<T>(path:string):Promise<T|null>{try{return JSON.parse(await (await this.read(path)).text()) as T;}catch(e){if(e instanceof DOMException && e.name==="NotFoundError")return null;throw e;}}
  writeJSON(path:string,value:unknown){return this.write(path,JSON.stringify(value,null,2));}
  async list(path:string){if(!this.root)return [];try{let dir=this.root;for(const part of path.split("/"))dir=await dir.getDirectoryHandle(part);const names:string[]=[];for await(const [name] of dir.entries())names.push(name);return names;}catch(e){if(e instanceof DOMException && e.name==="NotFoundError")return [];throw e;}}
  async remove(path:string,recursive=false){try{const {dir,name}=await this.parent(path);await dir.removeEntry(name,{recursive});}catch(e){if(!(e instanceof DOMException && e.name==="NotFoundError"))throw e;}}
  async lock<T>(name:string,fn:()=>Promise<T>,available=false):Promise<T|null>{return await navigator.locks.request("clipmint-"+this.namespace+"-"+name,{mode:"exclusive",ifAvailable:available},async lock=>lock?await fn():null);}
}
function canonical(value:unknown):unknown {if(typeof value==="string")return value.normalize("NFC").trim().replace(/\s+/g," ");if(Array.isArray(value))return value.map(canonical);if(value && typeof value==="object")return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));return value;}
export async function bytesHash(bytes:ArrayBuffer){const hash=await crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(hash)).map(v=>v.toString(16).padStart(2,"0")).join("");}
export const cacheHash=(v:unknown)=>bytesHash(new TextEncoder().encode(JSON.stringify(canonical(v))).buffer as ArrayBuffer);
