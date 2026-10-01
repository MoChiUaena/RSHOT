// Unattended local publication of the anonymous snapshot. Never loads or sends model credentials.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { beijingDate } from "@aihot/contracts/time";
import { PublicPreviewSchema, type PublicPreview } from "./lib/public-preview.ts";
import { PublicationCommandError, retryStatus, runPublicationCommand } from "./lib/publication-process.ts";

const root=path.resolve(import.meta.dirname,"..");
const snapshotPath="industry/preview/snapshot.json";
const privateDir=path.join(root,".data/preview-publication");
const lockPath=path.join(privateDir,"publish.lock");
const live=process.argv.includes("--live");
const noWait=process.argv.includes("--no-wait");
const day=beijingDate(new Date());
mkdirSync(privateDir,{recursive:true});
let stage="preflight";
let lockHeld=false;
const state:Record<string,unknown>={day,startedAt:new Date().toISOString(),status:"running",stage,modelRequests:0};
function save(){writeFileSync(path.join(privateDir,"latest.json"),JSON.stringify(state,null,2));
  writeFileSync(path.join(privateDir,`${day}.json`),JSON.stringify(state,null,2));}
function git(args:string[],code:string):string {
  return runPublicationCommand("git",["-C",root,...args],code,{cwd:root,timeoutMs:60000,maxBuffer:1024*1024});
}
function processOut(command:string,args:string[],code:string,timeout=120000):string {
  return runPublicationCommand(command,args,code,{cwd:root,timeoutMs:timeout}).trim();
}
function localGitTransport():Promise<string[]> {
  return new Promise((resolve)=>{
    const socket=connect({host:"127.0.0.1",port:7897});
    socket.setTimeout(1000);
    socket.once("connect",()=>{socket.end();resolve(["-c","http.sslBackend=openssl","-c","http.proxy=http://127.0.0.1:7897"]);});
    socket.once("error",()=>resolve(["-c","http.sslBackend=openssl"]));
    socket.once("timeout",()=>{socket.destroy();resolve(["-c","http.sslBackend=openssl"]);});
  });
}
function assertOrigin(){
  const raw=git(["remote","get-url","origin"],"origin-unavailable");
  let url:URL;try{url=new URL(raw);}catch{throw new Error("origin-not-rshot");}
  if(url.protocol!=="https:"||url.hostname.toLowerCase()!=="github.com"||url.username||url.password||
    !/^\/MoChiUaena\/RSHOT(?:\.git)?$/i.test(url.pathname)) throw new Error("origin-not-rshot");
  const branch=git(["symbolic-ref","--quiet","--short","HEAD"],"detached-head");
  if(!["main","codex/rshot"].includes(branch))throw new Error("unexpected-branch");
  if(git(["rev-parse","--abbrev-ref","--symbolic-full-name","@{upstream}"],"upstream-missing")!=="origin/main")
    throw new Error("upstream-not-main");
  if(git(["status","--porcelain=v1","--untracked-files=normal"],"git-status-failed"))throw new Error("working-tree-not-clean");
}
function acquireLock(){
  if(existsSync(lockPath)){
    let previous:{pid:number;startedAt:string};try{previous=JSON.parse(readFileSync(lockPath,"utf8"));}catch{throw new Error("publication-lock-invalid");}
    if(!Number.isInteger(previous.pid)||previous.pid<1||!Number.isFinite(Date.parse(previous.startedAt)))
      throw new Error("publication-lock-invalid");
    let alive=false;try{process.kill(previous.pid,0);alive=true;}catch{}
    if(alive||Date.now()-Date.parse(previous.startedAt)<4*3600000)throw new Error("publication-already-running");
    unlinkSync(lockPath);
  }
  const fd=openSync(lockPath,"wx");
  try{writeFileSync(fd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));}finally{closeSync(fd);}
  lockHeld=true;
}
async function latestReport(){
  const response=await fetch("http://127.0.0.1:3000/api/v1/dailies/latest",{redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error("daily-api-unavailable");
  const body=await response.json() as {report?:{date?:string;sections?:Array<{items?:unknown[]}>}};
  return {date:body.report?.date??null,entries:body.report?.sections?.reduce((n,section)=>n+(section.items?.length??0),0)??0};
}
async function waitForReport(){
  const hour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Shanghai",hour:"2-digit",hourCycle:"h23"}).format(new Date()));
  if(hour<8)throw new Error("daily-window-not-finished");
  const deadline=Date.now()+(noWait?0:150*60000);
  do{
    const report=await latestReport();
    if(report.date===day)return report;
    if(Date.now()>=deadline)break;
    await delay(120000);
  }while(true);
  throw new Error("today-daily-not-ready");
}
async function recordHealth(report:{date:string|null;entries:number}){
  const checks:Array<{attempt:number;reason:string;details:unknown}>=[];
  const value=await retryStatus(()=>{
    const raw=processOut(process.execPath,["--env-file=.env","scripts/updates-status.ts"],"update-status-unavailable",60000);
    return JSON.parse(raw) as {worker:{active:boolean;lastHeartbeat:string|null};admitted:{hour:number;day:number};
      sources:Array<{id:string;health:string;fail_count:number;last_ok_at:string|null}>};
  },(failure)=>{checks.push(failure);state.healthCheckFailures=checks;save();});
  const monitor={day,recordedAt:new Date().toISOString(),worker:value.worker,admitted:value.admitted,
    sources:value.sources.map(({id,health,fail_count,last_ok_at})=>({id,health,failCount:fail_count,lastOkAt:last_ok_at})),
    healthySources:value.sources.filter((source)=>source.health==="ok").length,report};
  const monitorDir=path.join(privateDir,"monitor");mkdirSync(monitorDir,{recursive:true});
  writeFileSync(path.join(monitorDir,`${day}.json`),JSON.stringify(monitor,null,2));
  return {workerActive:value.worker.active,healthySources:monitor.healthySources,totalSources:value.sources.length,admittedDay:value.admitted.day};
}
function recordEditorialSample(snapshot:PublicPreview){
  // Daily issue D covers [D-1 08:00, D 08:00) Beijing time, or [D-1 00:00, D 00:00) UTC.
  const end=Date.parse(`${day}T00:00:00.000Z`);
  const articles=snapshot.items.filter((item)=>{
    const at=Date.parse(item.timelineAt);
    return at>=end-86400000&&at<end;
  }).slice(0,100).map((item)=>({id:item.id,title:item.title,source:item.source,category:item.category,selected:item.selected,
    score:item.score,originalUrl:item.originalUrl,publishedAt:item.publishedAt,timelineAt:item.timelineAt,summary:item.summary,reason:item.reason}));
  const file=path.join(privateDir,"monitor",`${day}.json`);
  const current=JSON.parse(readFileSync(file,"utf8")) as Record<string,unknown>;
  writeFileSync(file,JSON.stringify({...current,auditWindowStart:new Date(end-86400000).toISOString(),
    auditWindowEnd:new Date(end).toISOString(),auditItems:articles},null,2));
  state.auditItems=articles.length;
}
async function waitForPages(sha:string){
  const deadline=Date.now()+8*60000;
  while(Date.now()<deadline){
    const output=processOut("gh",["run","list","--repo","MoChiUaena/RSHOT","--workflow","pages.yml","--limit","10",
      "--json","headSha,status,conclusion"],"pages-status-unavailable",30000);
    const runs=JSON.parse(output) as Array<{headSha:string;status:string;conclusion:string}>;
    const run=runs.find((entry)=>entry.headSha===sha);
    if(run?.status==="completed"){
      if(run.conclusion!=="success")throw new Error("pages-deployment-failed");
      return;
    }
    await delay(20000);
  }
  throw new Error("pages-deployment-unconfirmed");
}
async function publish(){
  assertOrigin();
  if(!live){const report=await latestReport();console.log(JSON.stringify({status:"ready",day,report,modelRequests:0,writes:0}));return;}
  acquireLock();save();
  stage="fetch";state.stage=stage;save();
  const transport=await localGitTransport();
  state.gitTransport=transport.length>2?"local-proxy":"direct";save();
  git([...transport,"fetch","origin","main"],"git-fetch-failed");
  if(git(["rev-parse","HEAD"],"local-head-unavailable")!==git(["rev-parse","refs/remotes/origin/main"],"remote-main-unavailable"))
    throw new Error("branch-diverged-from-main");
  stage="report";state.stage=stage;save();
  const report=await waitForReport();state.report=report;
  stage="health";state.stage=stage;save();
  state.monitor=await recordHealth(report);save();
  stage="export";state.stage=stage;save();
  const before=readFileSync(path.join(root,snapshotPath),"utf8");
  const prior=PublicPreviewSchema.parse(JSON.parse(before));
  const result=JSON.parse(processOut(process.execPath,["scripts/export-preview.ts","--apply"],"public-export-failed")) as {status:string;items:number;selected:number;reports:number;sources:number};
  if(result.status!=="exported")throw new Error("public-export-invalid");
  state.export={items:result.items,selected:result.selected,reports:result.reports,sources:result.sources};
  const after=PublicPreviewSchema.parse(JSON.parse(readFileSync(path.join(root,snapshotPath),"utf8")));
  recordEditorialSample(after);save();
  const {generatedAt:_,...oldContent}=prior;
  const {generatedAt:__,...newContent}=after;
  // An hourly hot ranking recomputation can change only its timestamp. That is not new public information.
  if(JSON.stringify({...oldContent,hot:{...oldContent.hot,computedAt:null}})===
     JSON.stringify({...newContent,hot:{...newContent.hot,computedAt:null}})){
    writeFileSync(path.join(root,snapshotPath),before);
    state.status="unchanged";state.stage="complete";state.finishedAt=new Date().toISOString();save();
    console.log(JSON.stringify({status:"unchanged",day,modelRequests:0,commits:0}));return;
  }
  stage="stage";state.stage=stage;save();
  if(git(["status","--porcelain=v1","--untracked-files=normal"],"git-status-failed")!==` M ${snapshotPath}`)
    throw new Error("unexpected-working-tree-change");
  git(["add","--",snapshotPath],"git-stage-failed");
  if(git(["diff","--cached","--name-only"],"staged-files-unavailable")!==snapshotPath)throw new Error("unexpected-staged-file");
  processOut(process.execPath,["scripts/check-secrets.ts","--staged"],"secret-guard-failed",60000);
  git(["diff","--cached","--check"],"patch-check-failed");
  stage="commit";state.stage=stage;save();
  git(["-c","user.name=MoChiUaena","-c","user.email=102353277+MoChiUaena@users.noreply.github.com",
    "commit","-m",`Refresh RSHOT public preview ${day}`],"git-commit-failed");
  const sha=git(["rev-parse","HEAD"],"commit-sha-unavailable");state.commit=sha;save();
  stage="push";state.stage=stage;save();
  git([...transport,"push","origin","HEAD:main"],"git-push-failed");
  stage="pages";state.stage=stage;save();
  await waitForPages(sha);
  state.status="published";state.stage="complete";state.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({status:"published",day,commit:sha,modelRequests:0,export:state.export}));
}
try{await publish();}catch(error){
  const reason=error instanceof Error&&/^[a-z][a-z0-9-]{3,64}$/.test(error.message)?error.message:"unexpected-failure";
  state.status="failed";state.stage=stage;state.reason=reason;
  if(error instanceof PublicationCommandError)state.failureDetails=error.details;
  state.finishedAt=new Date().toISOString();save();
  console.error(JSON.stringify({status:"failed",day,stage,reason:state.reason,failureDetails:state.failureDetails,secretsPrinted:false}));
  process.exitCode=1;
}finally{if(lockHeld)unlinkSync(lockPath);}
