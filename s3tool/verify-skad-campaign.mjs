import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";
const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP="id6756664337";
async function lp(p){const f=[];let t;do{const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,MaxKeys:1000,ContinuationToken:t}));for(const o of (r.Contents||[]))if(o.Size>0&&o.Key.endsWith(".parquet"))f.push(o.Key);t=r.NextContinuationToken;}while(t);return f;}
async function lpre(p){const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,Delimiter:"/",MaxKeys:1000}));return (r.CommonPrefixes||[]).map(x=>x.Prefix);}
async function schema(key){const resp=await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));const ch=[];for await(const c of resp.Body)ch.push(c);const buf=Buffer.concat(ch);const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);return parquetMetadata(ab).schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);}
async function rp(key,cols){const resp=await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));const ch=[];for await(const c of resp.Body)ch.push(c);const buf=Buffer.concat(ch);const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);const meta=parquetMetadata(ab);const all=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);const idx=cols.map(c=>all.indexOf(c));const rows=[];await parquetRead({file:ab,onComplete:raw=>{for(const row of raw){const o={};cols.forEach((c,i)=>o[c]=idx[i]>=0?row[idx[i]]:null);rows.push(o);}}});return rows;}

// 1. skad_installs 캠페인 관련 컬럼 전체
{
  const dt=(await lpre(`${BASE}t=skad_installs/`)).map(p=>p.match(/dt=[^/]+/)[0]).sort().at(-1);
  let sampleKey;
  for(const hp of await lpre(`${BASE}t=skad_installs/${dt}/`)){const fs=await lp(`${hp}app_id=${APP}/`);if(fs.length){sampleKey=fs[0];break;}}
  const cols=await schema(sampleKey);
  console.log("skad_installs 캠페인/네트워크 관련 컬럼:");
  console.log("  "+cols.filter(c=>/campaign|network|ad_|geo|country|source_app|conversion/i.test(c)).join(", "));
}

// 2. 캠페인명 값 분포 (media_source별) — 7/7~7/19 iOS, flag≠true
const camps={}; // media -> {campaign -> count}
for(const dt of (await lpre(`${BASE}t=skad_installs/`)).map(p=>p.match(/dt=[^/]+/)[0]).filter(d=>d>="dt=2026-07-06").sort()){
  for(const hp of await lpre(`${BASE}t=skad_installs/${dt}/`)){
    for(const f of await lp(`${hp}app_id=${APP}/`)){
      for(const r of await rp(f,["media_source","af_attribution_flag","ad_network_campaign_name","install_date"])){
        if(String(r.af_attribution_flag).toLowerCase()==="true")continue;
        const kd=r.install_date?String(r.install_date).slice(0,10):null;
        if(!kd||kd<"2026-07-07"||kd>"2026-07-19")continue;
        const m=r.media_source||"unknown", c=r.ad_network_campaign_name||"(null)";
        (camps[m]=camps[m]||{});camps[m][c]=(camps[m][c]||0)+1;
      }
    }
  }
}
console.log("\n=== 매체별 캠페인명 분포 (SKAN flag≠true, 7/7~7/19) ===");
for(const [m,cs] of Object.entries(camps)){
  console.log(`\n■ ${m}`);
  Object.entries(cs).sort((a,b)=>b[1]-a[1]).slice(0,25).forEach(([c,n])=>console.log(`   ${n.toString().padStart(4)}  ${c}`));
}

// 3. skad_inapps 존재/스키마 (매출 컬럼)
console.log("\n=== skad_inapps ===");
const siDts=(await lpre(`${BASE}t=skad_inapps/`)).map(p=>p.replace(`${BASE}t=skad_inapps/`,"").replace(/\/$/,"")).sort();
console.log("dt:", siDts.join(", ")||"없음");
if(siDts.length){
  const dt=siDts.at(-1);let sk;
  for(const hp of await lpre(`${BASE}t=skad_inapps/${dt}/`)){const fs=await lp(`${hp}app_id=${APP}/`);if(fs.length){sk=fs[0];break;}}
  if(sk){const cols=await schema(sk);console.log("매출/이벤트/캠페인 관련 컬럼:", cols.filter(c=>/revenue|event|campaign|conversion|value|flag/i.test(c)).join(", "));}
}
