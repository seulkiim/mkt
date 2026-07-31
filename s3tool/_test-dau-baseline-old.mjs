import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";
import { writeFileSync } from "fs";

const BASE   = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const OS_OF = { "com.albus.idolharvest":"Android", "id6756664337":"iOS" };
const APP_IDS = Object.keys(OS_OF);

const START="2026-07-07";
const kstNow=new Date(Date.now()+9*3600000);
const endStr=new Date(kstNow.getTime()-24*3600000).toISOString().slice(0,10);
const TARGET_KST=[];
for(let t=Date.parse(START+"T00:00:00Z"); t<=Date.parse(endStr+"T00:00:00Z"); t+=86400000){
  TARGET_KST.push(new Date(t).toISOString().slice(0,10));
}
process.stderr.write(`대상 코호트: ${START} ~ ${endStr} (${TARGET_KST.length}일)\n`);
const inRange = kd => TARGET_KST.includes(kd);

function toKSTDate(ts){ if(ts==null)return null; const s=String(ts); const norm=s.replace(" ","T")+(s.includes("T")||s.includes("+")?"":"Z"); const d=typeof ts==="number"?new Date(ts):new Date(norm); return isNaN(d.getTime())?null:new Date(d.getTime()+9*3600000).toISOString().slice(0,10); }

async function listParquet(prefix){const files=[];let token;do{const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:prefix,MaxKeys:1000,ContinuationToken:token}));for(const o of (r.Contents||[]))if(o.Size>0&&o.Key.endsWith(".parquet"))files.push(o.Key);token=r.NextContinuationToken;}while(token);return files;}
async function listPrefixes(prefix){const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:prefix,Delimiter:"/",MaxKeys:1000}));return (r.CommonPrefixes||[]).map(p=>p.Prefix);}
async function readParquet(key,wantCols){const resp=await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));const chunks=[];for await(const c of resp.Body)chunks.push(c);const buf=Buffer.concat(chunks);const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);const meta=parquetMetadata(ab);const allCols=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);const present=wantCols.filter(c=>allCols.includes(c));const rows=[];await parquetRead({file:ab,metadata:meta,columns:present,rowFormat:"object",onComplete:raw=>{for(const row of raw){const o={};for(const c of wantCols)o[c]=present.includes(c)?row[c]:null;rows.push(o);}}});return rows;}
async function dtList(tbl,minDt){const base=`${BASE}t=${tbl}/`;const ps=await listPrefixes(base);return ps.map(p=>p.replace(base,"").replace(/\/$/,"")).filter(dt=>dt>=minDt).sort();}

// ══ [7] BASELINE (OLD LOGIC, unmodified control flow) — dumps RAW ids instead of compact ints ══
process.stderr.write("[7] sessions (BASELINE raw-id dump)\n");
const RAW={};
function rawSet(country,date){ if(!RAW[country])RAW[country]={}; if(!RAW[country][date])RAW[country][date]=new Set(); return RAW[country][date]; }
for(const dt of await dtList("sessions",START)){
  for(const hp of await listPrefixes(`${BASE}t=sessions/${dt}/`)){
    for(const appId of APP_IDS){
      for(const f of await listParquet(`${hp}app_id=${appId}/`)){
        const rows=await readParquet(f,["event_time","appsflyer_id","customer_user_id","country_code"]);
        for(const r of rows){
          const ed=toKSTDate(r.event_time); if(!ed||!inRange(ed))continue;
          const rawId=r.appsflyer_id||r.customer_user_id; if(!rawId)continue;
          rawSet(r.country_code||"??",ed).add(rawId);
        }
      }
    }
  }
  process.stderr.write(`  sessions ${dt}\n`);
}

const dump={};
for(const [country,byDate] of Object.entries(RAW)){
  dump[country]={};
  for(const [date,set] of Object.entries(byDate)) dump[country][date]=[...set].sort();
}
writeFileSync("C:/Users/STZ940/AppData/Local/Temp/claude/C--Users-STZ940-Documents-GitHub-mkt-report/cf1d2b8d-9ab4-403d-9cdf-f01449d0d17f/scratchpad/dau-raw-baseline.json", JSON.stringify(dump,null,2), "utf8");
let total=0; for(const byDate of Object.values(dump)) for(const ids of Object.values(byDate)) total+=ids.length;
process.stdout.write(`baseline dump written. countries=${Object.keys(dump).length} total(country,date) raw-id entries summed=${total}\n`);
