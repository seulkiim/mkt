import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";
const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS=["com.albus.idolharvest","id6756664337"];
async function lp(p){const f=[];let t;do{const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,MaxKeys:1000,ContinuationToken:t}));for(const o of (r.Contents||[]))if(o.Size>0&&o.Key.endsWith(".parquet"))f.push(o.Key);t=r.NextContinuationToken;}while(t);return f;}
async function lpre(p){const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,Delimiter:"/",MaxKeys:1000}));return (r.CommonPrefixes||[]).map(x=>x.Prefix);}
async function rp(key,cols){const resp=await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));const ch=[];for await(const c of resp.Body)ch.push(c);const buf=Buffer.concat(ch);const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);const meta=parquetMetadata(ab);const all=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);const idx=cols.map(c=>all.indexOf(c));const rows=[];await parquetRead({file:ab,onComplete:raw=>{for(const row of raw){const o={};cols.forEach((c,i)=>o[c]=idx[i]>=0?row[idx[i]]:null);rows.push(o);}}});return rows;}
async function dts(tbl){const b=`${BASE}t=${tbl}/`;return (await lpre(b)).map(p=>p.replace(b,"").replace(/\/$/,"")).filter(d=>d>="dt=2026-07-14"&&d<="dt=2026-07-17").sort();}

// A. impressions 값 분포 + 매출 (revenue>0 레코드 대상)
const buckets={"null/0":{n:0,rev:0},"1":{n:0,rev:0},"2-10":{n:0,rev:0},"11-100":{n:0,rev:0},"100+":{n:0,rev:0}};
// B. af_ad_type별 (레코드 단위) imp,rev
const byType={};
// C. 고단가 유닛 원시 샘플
const hiUnit="52baaa6a9c4630b1"; const samples=[];
for(const tbl of ["attributed_ad_revenue_v2","organic_ad_revenue_v2","retargeting_ad_revenue_v2"]){
  for(const dt of await dts(tbl)){
    const vs=(await lpre(`${BASE}t=${tbl}/${dt}/`)).map(p=>({v:parseInt(p.match(/version=(\d+)/)?.[1]??"-1"),prefix:p})).filter(x=>x.v>=0).sort((a,b)=>b.v-a.v);
    if(!vs.length)continue;
    for(const appId of APP_IDS){
      for(const f of await lp(`${vs[0].prefix}app_id=${appId}/`)){
        for(const r of await rp(f,["event_revenue_usd","impressions","ad_unit","af_ad_type"])){
          const rev=parseFloat(r.event_revenue_usd)||0; if(rev<=0)continue;
          const impRaw=r.impressions; const imp=parseFloat(impRaw)||0;
          const b=(impRaw==null||imp===0)?"null/0":imp===1?"1":imp<=10?"2-10":imp<=100?"11-100":"100+";
          buckets[b].n++; buckets[b].rev+=rev;
          const t=r.af_ad_type||"(null)"; if(!byType[t])byType[t]={n:0,imp:0,rev:0};byType[t].n++;byType[t].imp+=imp;byType[t].rev+=rev;
          if(r.ad_unit===hiUnit&&samples.length<15)samples.push({imp:impRaw,rev:rev.toFixed(4),type:r.af_ad_type});
        }
      }
    }
  }
  process.stderr.write(`${tbl} done\n`);
}
console.log("=== A. revenue>0 레코드의 impressions 값 분포 ===");
let tn=0,tr=0;for(const v of Object.values(buckets)){tn+=v.n;tr+=v.rev;}
for(const [k,v] of Object.entries(buckets))console.log(`  imp ${k.padEnd(7)}: ${v.n.toString().padStart(7)}건 (${(v.n/tn*100).toFixed(1)}%)  매출 $${v.rev.toFixed(0).padStart(6)} (${(v.rev/tr*100).toFixed(1)}%)`);

console.log("\n=== B. af_ad_type별 (레코드 단위) — imp합·매출·행당노출·eCPM ===");
for(const [t,v] of Object.entries(byType).sort((a,b)=>b[1].rev-a[1].rev)){
  const ecpm=v.imp>0?v.rev/v.imp*1000:null; const ipr=v.imp/v.n;
  console.log(`  ${t.padEnd(18)} rev $${v.rev.toFixed(0).padStart(6)}  imp합 ${Math.round(v.imp).toLocaleString().padStart(9)}  행수 ${v.n.toString().padStart(6)}  행당imp ${ipr.toFixed(2).padStart(7)}  eCPM ${ecpm==null?"-":"$"+ecpm.toFixed(2)}`);
}
console.log("\n=== C. 고단가 유닛("+hiUnit+") 원시 레코드 샘플 (impressions, rev, af_ad_type) ===");
samples.forEach(s=>console.log("  ",JSON.stringify(s)));
