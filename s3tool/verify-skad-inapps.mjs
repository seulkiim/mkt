import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";
const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP="id6756664337";
async function lp(p){const f=[];let t;do{const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,MaxKeys:1000,ContinuationToken:t}));for(const o of (r.Contents||[]))if(o.Size>0&&o.Key.endsWith(".parquet"))f.push(o.Key);t=r.NextContinuationToken;}while(t);return f;}
async function lpre(p){const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,Delimiter:"/",MaxKeys:1000}));return (r.CommonPrefixes||[]).map(x=>x.Prefix);}
async function rp(key,cols){const resp=await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));const ch=[];for await(const c of resp.Body)ch.push(c);const buf=Buffer.concat(ch);const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);const meta=parquetMetadata(ab);const all=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);const idx=cols.map(c=>all.indexOf(c));const rows=[];await parquetRead({file:ab,onComplete:raw=>{for(const row of raw){const o={};cols.forEach((c,i)=>o[c]=idx[i]>=0?row[idx[i]]:null);rows.push(o);}}});return rows;}
async function allcols(key){const resp=await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));const ch=[];for await(const c of resp.Body)ch.push(c);const buf=Buffer.concat(ch);const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);return parquetMetadata(ab).schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);}

const dts=(await lpre(`${BASE}t=skad_inapps/`)).map(p=>p.match(/dt=[^/]+/)[0]).filter(d=>d>="dt=2026-07-06").sort();
// 전체 컬럼 + 날짜 관련
let sk;for(const hp of await lpre(`${BASE}t=skad_inapps/${dts.at(-1)}/`)){const fs=await lp(`${hp}app_id=${APP}/`);if(fs.length){sk=fs[0];break;}}
const cols=await allcols(sk);
console.log("skad_inapps 전체 컬럼("+cols.length+"):\n  "+cols.join(", "));
console.log("\n날짜 관련:", cols.filter(c=>/date|time/i.test(c)).join(", "));

// 샘플 행 + 매출 집계 (event_name, skad_revenue, flag별)
const byEvent={}; let flagTrue=0, flagFalse=0, revTrue=0, revFalse=0;
let samples=[];
for(const dt of dts){
  for(const hp of await lpre(`${BASE}t=skad_inapps/${dt}/`)){
    for(const f of await lp(`${hp}app_id=${APP}/`)){
      for(const r of await rp(f,["event_name","skad_revenue","event_value","min_revenue","max_revenue","af_attribution_flag","ad_network_campaign_name","media_source","install_date","event_time"])){
        const flag=String(r.af_attribution_flag).toLowerCase();
        const rev=parseFloat(r.skad_revenue)||0;
        byEvent[r.event_name||"(null)"]=(byEvent[r.event_name||"(null)"]||0)+1;
        if(flag==="true"){flagTrue++;revTrue+=rev;}else{flagFalse++;revFalse+=rev;}
        if(samples.length<6&&rev>0)samples.push(r);
      }
    }
  }
}
console.log("\nevent_name 분포:", JSON.stringify(byEvent));
console.log(`\nflag=true: ${flagTrue}행 skad_revenue합=$${revTrue.toFixed(2)}`);
console.log(`flag≠true: ${flagFalse}행 skad_revenue합=$${revFalse.toFixed(2)}`);
console.log("\n샘플(skad_revenue>0):");
samples.forEach(s=>console.log("  ",JSON.stringify({ev:s.event_name,rev:s.skad_revenue,min:s.min_revenue,max:s.max_revenue,camp:s.ad_network_campaign_name,inst:String(s.install_date).slice(0,10),et:String(s.event_time).slice(0,10),flag:s.af_attribution_flag})));
