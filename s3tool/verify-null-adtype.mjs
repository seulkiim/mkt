import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";
const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP=["com.albus.idolharvest","id6756664337"];
async function lp(p){const f=[];let t;do{const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,MaxKeys:1000,ContinuationToken:t}));for(const o of (r.Contents||[]))if(o.Size>0&&o.Key.endsWith(".parquet"))f.push(o.Key);t=r.NextContinuationToken;}while(t);return f;}
async function lpre(p){const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,Delimiter:"/",MaxKeys:1000}));return (r.CommonPrefixes||[]).map(x=>x.Prefix);}
async function rp(key,cols){const resp=await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));const ch=[];for await(const c of resp.Body)ch.push(c);const buf=Buffer.concat(ch);const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);const meta=parquetMetadata(ab);const all=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);const idx=cols.map(c=>all.indexOf(c));const rows=[];await parquetRead({file:ab,onComplete:raw=>{for(const row of raw){const o={};cols.forEach((c,i)=>o[c]=idx[i]>=0?row[idx[i]]:null);rows.push(o);}}});return rows;}

const byMedia={},byPlace={},byAdUnit={};let n=0,rev=0,imp=0;const samp=[];
for(const tbl of ["attributed_ad_revenue_v2","organic_ad_revenue_v2","retargeting_ad_revenue_v2"]){
  const dts=(await lpre(`${BASE}t=${tbl}/`)).map(p=>p.match(/dt=[^/]+/)[0]).filter(d=>d>="dt=2026-07-06").sort();
  for(const dt of dts){
    const vs=(await lpre(`${BASE}t=${tbl}/${dt}/`)).map(p=>({v:parseInt(p.match(/version=(\d+)/)?.[1]??"-1"),prefix:p})).filter(x=>x.v>=0).sort((a,b)=>b.v-a.v);
    if(!vs.length)continue;
    for(const app of APP){
      for(const f of await lp(`${vs[0].prefix}app_id=${app}/`)){
        for(const r of await rp(f,["af_ad_type","event_revenue_usd","impressions","placement","media_source","ad_unit"])){
          if(!(r.af_ad_type==null||r.af_ad_type===""))continue;
          const v=parseFloat(r.event_revenue_usd)||0, im=parseFloat(r.impressions)||0;
          n++;rev+=v;imp+=im;
          const m=r.media_source||"organic"; byMedia[m]=byMedia[m]||{rev:0,imp:0}; byMedia[m].rev+=v; byMedia[m].imp+=im;
          const pl=r.placement==null||r.placement===""?"(빈값)":String(r.placement); byPlace[pl]=byPlace[pl]||{rev:0,imp:0}; byPlace[pl].rev+=v; byPlace[pl].imp+=im;
          const au=r.ad_unit||"(빈값)"; byAdUnit[au]=byAdUnit[au]||{rev:0,imp:0}; byAdUnit[au].rev+=v; byAdUnit[au].imp+=im;
          if(samp.length<8)samp.push({place:r.placement,ad_unit:r.ad_unit,media:r.media_source,rev:v.toFixed(4),imp:im});
        }
      }
    }
  }
  process.stderr.write(`${tbl} done\n`);
}
console.log(`\n빈값(af_ad_type) 레코드: ${n}건 | 매출 $${rev.toFixed(2)} | 노출 ${Math.round(imp)} | eCPM $${(rev/imp*1000).toFixed(2)}`);
console.log("\n매체별:");for(const [k,v] of Object.entries(byMedia).sort((a,b)=>b[1].rev-a[1].rev))console.log("  "+k.padEnd(20)+" $"+v.rev.toFixed(0).padStart(7)+"  eCPM $"+(v.imp>0?v.rev/v.imp*1000:0).toFixed(2));
console.log("\nplacement별(상위 12):");for(const [k,v] of Object.entries(byPlace).sort((a,b)=>b[1].rev-a[1].rev).slice(0,12))console.log("  "+k.padEnd(30)+" $"+v.rev.toFixed(0).padStart(7)+"  노출 "+Math.round(v.imp).toString().padStart(9)+"  eCPM $"+(v.imp>0?v.rev/v.imp*1000:0).toFixed(2));
console.log("\nad_unit별(상위 8):");for(const [k,v] of Object.entries(byAdUnit).sort((a,b)=>b[1].rev-a[1].rev).slice(0,8))console.log("  "+k.padEnd(20)+" $"+v.rev.toFixed(0).padStart(7)+"  eCPM $"+(v.imp>0?v.rev/v.imp*1000:0).toFixed(2));
console.log("\n샘플:");samp.forEach(s=>console.log("  "+JSON.stringify(s)));
