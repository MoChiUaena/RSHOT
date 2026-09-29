// Local-only inspection of the same /RSHOT/ paths that GitHub Pages serves.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"../dist/preview");
const types:Record<string,string>={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".png":"image/png"};
http.createServer(async(req,res)=>{
  try{
    const relative=decodeURIComponent(new URL(req.url??"/","http://localhost").pathname).replace(/^\/RSHOT(?=\/|$)/,"").replace(/^\/+/,"");
    const file=path.resolve(root,relative||"index.html");
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    const body=await readFile(file);
    res.writeHead(200,{"content-type":types[path.extname(file)]??"application/octet-stream","cache-control":"no-store"});
    res.end(req.method==="HEAD"?undefined:body);
  }catch{res.writeHead(404);res.end("Not found");}
}).listen(3040,"127.0.0.1",()=>console.log("RSHOT Pages 预览：http://127.0.0.1:3040/RSHOT/"));
