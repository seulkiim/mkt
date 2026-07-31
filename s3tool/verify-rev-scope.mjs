import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";
const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS=["com.albus.idolharvest","id6756664337"];
const START="2026-07-07", END="2026-07-19";
function toKST(ts){if(ts==null)return null;const s=String(ts);const n=s.replace(" ","T")+(s.includes("T")||s.includes("+")?"":"Z");const d=typeof ts==="number"?new Date(ts):new Date(n);return isNaN(d)?null:new Date(d.getTime()+9*3600000).toISOString().slice(0,10);}
function days(a,b){return Math.round((Date.parse(b+"T00:00:00Z")-Date.parse(a+"T00:00:00Z"))/86400000);}
const inR=d=>d>=START&&d<=END;
async function lp(p){const f=[];let t;do{const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,MaxKeys:1000,ContinuationToken:t}));for(const o of (r.Contents||[]))if(o.Size>0&&o.Key.endsWith(".parquet"))f.push(o.Key);t=r.NextContinuationToken;}while(t);return f;}
async function lpre(p){const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,Delimiter:"/",MaxKeys:1000}));return (r.CommonPrefixes||[]).map(x=>x.Prefix);}
async function rp(key,cols){const resp=await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));const ch=[];for await(const c of resp.Body)ch.push(c);const buf=Buffer.concat(ch);const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);const meta=parquetMetadata(ab);const all=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);const idx=cols.map(c=>all.indexOf(c));const rows=[];await parquetRead({file:ab,onComplete:raw=>{for(const row of raw){const o={};cols.forEach((c,i)=>o[c]=idx[i]>=0?row[idx[i]]:null);rows.push(o);}}});return rows;}
async function dts(tbl){const b=`${BASE}t=${tbl}/`;return (await lpre(b)).map(p=>p.replace(b,"").replace(/\/$/,"")).filter(d=>d>="dt=2026-07-06").sort();}

// inapps: D1 윈도우(설치 코호트 범위, days<=1) 매출을 event_name별로 집계
const byEvent={}; let afp=0, allrev=0;
for(const dt of await dts("inapps")){
  for(const hp of await lpre(`${BASE}t=inapps/${dt}/`)){
    for(const appId of APP_IDS){
      for(const f of await lp(`${hp}app_id=${appId}/`)){
        for(const r of await rp(f,["event_time","install_time","event_name","event_revenue_usd"])){
          const rev=parseFloat(r.event_revenue_usd)||0; if(rev<=0)continue;
          const ind=toKST(r.install_time); if(!ind||!inR(ind))continue;
          const evd=toKST(r.event_time); if(!evd)continue;
          const dd=days(ind,evd); if(dd<0||dd>1)continue;
          byEvent[r.event_name||"(null)"]=(byEvent[r.event_name||"(null)"]||0)+rev;
          allrev+=rev; if(r.event_name==="af_purchase")afp+=rev;
        }
      }
    }
  }
  process.stderr.write(`inapps ${dt}\n`);
}
console.log("=== inapps D1 윈도우 매출: event_name별 (event_revenue_usd>0) ===");
Object.entries(byEvent).sort((a,b)=>b[1]-a[1]).forEach(([e,v])=>console.log("  "+e.padEnd(24)+"$"+v.toFixed(2)));
console.log(`\naf_purchase만: $${afp.toFixed(2)}`);
console.log(`inapps 전체 매출이벤트: $${allrev.toFixed(2)}`);
console.log(`→ 현재 스크립트는 af_purchase만 IAP로 집계. 차액 = $${(allrev-afp).toFixed(2)}`);
