import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";
const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP="id6756664337"; // iOS
function toKST(ts){if(ts==null)return null;const s=String(ts);const n=s.replace(" ","T")+(s.includes("T")||s.includes("+")?"":"Z");const d=typeof ts==="number"?new Date(ts):new Date(n);return isNaN(d)?null:new Date(d.getTime()+9*3600000).toISOString().slice(0,10);}
function days(a,b){return Math.round((Date.parse(b+"T00:00:00Z")-Date.parse(a+"T00:00:00Z"))/86400000);}
async function lp(p){const f=[];let t;do{const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,MaxKeys:1000,ContinuationToken:t}));for(const o of (r.Contents||[]))if(o.Size>0&&o.Key.endsWith(".parquet"))f.push(o.Key);t=r.NextContinuationToken;}while(t);return f;}
async function lpre(p){const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,Delimiter:"/",MaxKeys:1000}));return (r.CommonPrefixes||[]).map(x=>x.Prefix);}
async function rp(key,cols){const resp=await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));const ch=[];for await(const c of resp.Body)ch.push(c);const buf=Buffer.concat(ch);const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);const meta=parquetMetadata(ab);const all=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);const idx=cols.map(c=>all.indexOf(c));const rows=[];await parquetRead({file:ab,onComplete:raw=>{for(const row of raw){const o={};cols.forEach((c,i)=>o[c]=idx[i]>=0?row[idx[i]]:null);rows.push(o);}}});return rows;}
async function dts(tbl,min){const b=`${BASE}t=${tbl}/`;return (await lpre(b)).map(p=>p.replace(b,"").replace(/\/$/,"")).filter(d=>d>=min).sort();}

const COH="2026-07-17";
let iap=0,iaa=0; const detail=[];
// IAP
for(const dt of await dts("inapps","dt=2026-07-16")){
  for(const hp of await lpre(`${BASE}t=inapps/${dt}/`)){
    for(const f of await lp(`${hp}app_id=${APP}/`)){
      for(const r of await rp(f,["event_time","install_time","event_name","event_revenue_usd","media_source","country_code"])){
        if(r.event_name!=="af_purchase")continue;
        if(r.media_source!=="applovin_int"||r.country_code!=="UK")continue;
        const ind=toKST(r.install_time);if(ind!==COH)continue;
        const dd=days(ind,toKST(r.event_time));if(dd<0||dd>1)continue;
        const rev=parseFloat(r.event_revenue_usd)||0;if(rev<=0)continue;
        iap+=rev;detail.push(`IAP dt=${dt} ev=${toKST(r.event_time)} dd=${dd} $${rev.toFixed(2)}`);
      }
    }
  }
}
// IAA (max version)
for(const tbl of ["attributed_ad_revenue_v2","organic_ad_revenue_v2","retargeting_ad_revenue_v2"]){
  for(const dt of await dts(tbl,"dt=2026-07-16")){
    const vs=(await lpre(`${BASE}t=${tbl}/${dt}/`)).map(p=>({v:parseInt(p.match(/version=(\d+)/)?.[1]??"-1"),prefix:p})).filter(x=>x.v>=0).sort((a,b)=>b.v-a.v);
    if(!vs.length)continue;
    for(const f of await lp(`${vs[0].prefix}app_id=${APP}/`)){
      for(const r of await rp(f,["event_time","install_time","event_revenue_usd","media_source","country_code"])){
        if(r.media_source!=="applovin_int"||r.country_code!=="UK")continue;
        const ind=toKST(r.install_time);if(ind!==COH)continue;
        const dd=days(ind,toKST(r.event_time));if(dd<0||dd>1)continue;
        const rev=parseFloat(r.event_revenue_usd)||0;if(rev<=0)continue;
        iaa+=rev;detail.push(`IAA ${tbl.slice(0,4)} dt=${dt} ev=${toKST(r.event_time)} dd=${dd} $${rev.toFixed(4)}`);
      }
    }
  }
}
console.log("=== 7/17 UK iOS applovin D1 (days_since<=1) 원본 재계산 ===");
detail.forEach(d=>console.log("  "+d));
console.log(`IAP=$${iap.toFixed(2)}  IAA=$${iaa.toFixed(2)}  D1합계=$${(iap+iaa).toFixed(2)}`);
