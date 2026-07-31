import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";
const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS=["com.albus.idolharvest","id6756664337"];
async function lp(p){const f=[];let t;do{const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,MaxKeys:1000,ContinuationToken:t}));for(const o of (r.Contents||[]))if(o.Size>0&&o.Key.endsWith(".parquet"))f.push(o.Key);t=r.NextContinuationToken;}while(t);return f;}
async function lpre(p){const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,Delimiter:"/",MaxKeys:1000}));return (r.CommonPrefixes||[]).map(x=>x.Prefix);}
async function rp(key,cols){const resp=await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));const ch=[];for await(const c of resp.Body)ch.push(c);const buf=Buffer.concat(ch);const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);const meta=parquetMetadata(ab);const all=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);const idx=cols.map(c=>all.indexOf(c));const rows=[];await parquetRead({file:ab,onComplete:raw=>{for(const row of raw){const o={};cols.forEach((c,i)=>o[c]=idx[i]>=0?row[idx[i]]:null);rows.push(o);}}});return rows;}
async function dts(tbl){const b=`${BASE}t=${tbl}/`;return (await lpre(b)).map(p=>p.replace(b,"").replace(/\/$/,"")).filter(d=>d>="dt=2026-07-12"&&d<="dt=2026-07-18").sort();}

// ad_unit별로 딸린 속성 수집: ad_revenue_ad_type, af_ad_type, ad_type, placement, segment, ad_unit
const U={}; // ad_unit -> {imp,rev, types:Set, placements:Set, segs:Set, adtypes:Set}
for(const tbl of ["attributed_ad_revenue_v2","organic_ad_revenue_v2","retargeting_ad_revenue_v2"]){
  for(const dt of await dts(tbl)){
    const vs=(await lpre(`${BASE}t=${tbl}/${dt}/`)).map(p=>({v:parseInt(p.match(/version=(\d+)/)?.[1]??"-1"),prefix:p})).filter(x=>x.v>=0).sort((a,b)=>b.v-a.v);
    if(!vs.length)continue;
    for(const appId of APP_IDS){
      for(const f of await lp(`${vs[0].prefix}app_id=${appId}/`)){
        for(const r of await rp(f,["event_revenue_usd","impressions","ad_unit","ad_revenue_ad_type","af_ad_type","placement","segment","mediation_network","monetization_network"])){
          const rev=parseFloat(r.event_revenue_usd)||0; if(rev<=0)continue;
          const u=r.ad_unit||"(null)";
          if(!U[u])U[u]={imp:0,rev:0,adrt:new Set(),afat:new Set(),pl:new Set(),seg:new Set(),med:new Set(),mon:new Set()};
          U[u].imp+=parseFloat(r.impressions)||0; U[u].rev+=rev;
          if(r.ad_revenue_ad_type)U[u].adrt.add(r.ad_revenue_ad_type);
          if(r.af_ad_type)U[u].afat.add(r.af_ad_type);
          if(r.placement)U[u].pl.add(String(r.placement));
          if(r.segment)U[u].seg.add(String(r.segment));
          if(r.mediation_network)U[u].med.add(String(r.mediation_network));
          if(r.monetization_network)U[u].mon.add(String(r.monetization_network));
        }
      }
    }
  }
  process.stderr.write(`${tbl} done\n`);
}
const arr=Object.entries(U).sort((a,b)=>b[1].rev-a[1].rev);
console.log("ad_unit별 속성 (매출순, 7/12~7/18 이벤트 표본):\n");
for(const [u,v] of arr){
  const ecpm=v.imp>0?v.rev/v.imp*1000:0;
  console.log(`ad_unit=${u}`);
  console.log(`   rev=$${v.rev.toFixed(0)}  imp=${Math.round(v.imp).toLocaleString()}  eCPM=$${ecpm.toFixed(2)}`);
  console.log(`   ad_revenue_ad_type=[${[...v.adrt].join(", ")}]  af_ad_type=[${[...v.afat].join(", ")}]`);
  console.log(`   placement=[${[...v.pl].slice(0,5).join(", ")}]  segment=[${[...v.seg].slice(0,5).join(", ")}]`);
  console.log(`   mediation=[${[...v.med].join(", ")}]  monetization=[${[...v.mon].join(", ")}]`);
}
