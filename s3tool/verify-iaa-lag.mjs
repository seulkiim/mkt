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

// IAA: install 코호트 in range, days_since 버킷별 매출 (누적 파악)
const bucket={}; let total=0; const samples=[];
for(const tbl of ["attributed_ad_revenue_v2","organic_ad_revenue_v2","retargeting_ad_revenue_v2"]){
  for(const dt of await dts(tbl)){
    const vs=(await lpre(`${BASE}t=${tbl}/${dt}/`)).map(p=>({v:parseInt(p.match(/version=(\d+)/)?.[1]??"-1"),prefix:p})).filter(x=>x.v>=0).sort((a,b)=>b.v-a.v);
    if(!vs.length)continue;
    for(const appId of APP_IDS){
      for(const f of await lp(`${vs[0].prefix}app_id=${appId}/`)){
        for(const r of await rp(f,["event_time","install_time","event_revenue_usd"])){
          const rev=parseFloat(r.event_revenue_usd)||0; if(rev<=0)continue;
          const ind=toKST(r.install_time); if(!ind||!inR(ind))continue;
          const evd=toKST(r.event_time); if(!evd)continue;
          const dd=days(ind,evd);
          bucket[dd]=(bucket[dd]||0)+rev; total+=rev;
          if(samples.length<8&&dd<0)samples.push({ind,evd,dd,rev});
        }
      }
    }
  }
  process.stderr.write(`${tbl} done\n`);
}
console.log("=== IAA 매출: days_since_install 버킷별 (설치코호트 7/7~7/19) ===");
const keys=Object.keys(bucket).map(Number).sort((a,b)=>a-b);
let cum=0;
for(const k of keys){cum+=bucket[k];console.log(`  day ${String(k).padStart(3)}: $${bucket[k].toFixed(2).padStart(10)}   누적 $${cum.toFixed(2)}`);}
console.log(`\n총 IAA(모든 경과일): $${total.toFixed(2)}`);
// 누적 D0,D1,D2,D3
const cumTo=n=>keys.filter(k=>k>=0&&k<=n).reduce((a,k)=>a+bucket[k],0);
console.log(`누적 D0(<=0): $${cumTo(0).toFixed(2)}`);
console.log(`누적 D1(<=1): $${cumTo(1).toFixed(2)}`);
console.log(`누적 D2(<=2): $${cumTo(2).toFixed(2)}`);
console.log(`누적 D3(<=3): $${cumTo(3).toFixed(2)}`);
if(samples.length){console.log("\ndays_since<0 (설치 이전 이벤트?) 샘플:");samples.forEach(s=>console.log("  ",JSON.stringify(s)));}
