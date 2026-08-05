import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";
import { readFileSync } from "fs";
import { dataPath } from "./paths.mjs";
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

// D1 광고노출/매출 수집: key media|country|cohortdate -> {imp, rev}
const B={};
const gk=(m,c,d)=>m+"|"+c+"|"+d;
for(const tbl of ["attributed_ad_revenue_v2","organic_ad_revenue_v2","retargeting_ad_revenue_v2"]){
  for(const dt of await dts(tbl)){
    const vs=(await lpre(`${BASE}t=${tbl}/${dt}/`)).map(p=>({v:parseInt(p.match(/version=(\d+)/)?.[1]??"-1"),prefix:p})).filter(x=>x.v>=0).sort((a,b)=>b.v-a.v);
    if(!vs.length)continue;
    for(const appId of APP_IDS){
      for(const f of await lp(`${vs[0].prefix}app_id=${appId}/`)){
        for(const r of await rp(f,["event_time","install_time","event_revenue_usd","media_source","country_code","impressions"])){
          const rev=parseFloat(r.event_revenue_usd)||0; if(rev<=0)continue;
          const ind=toKST(r.install_time); if(!ind||!inR(ind))continue;
          const evd=toKST(r.event_time); if(!evd)continue;
          const dd=Math.max(0,days(ind,evd)); if(dd>1)continue; // D1 윈도우
          const k=gk(r.media_source||"organic",r.country_code||"??",ind);
          if(!B[k])B[k]={imp:0,rev:0};
          B[k].imp+=parseFloat(r.impressions)||0; // 실제 impressions 컬럼 합산
          B[k].rev+=rev;
        }
      }
    }
  }
  process.stderr.write(`${tbl} done\n`);
}
// 설치수는 결과 JSON에서
const rows=JSON.parse(readFileSync(dataPath("geo-cohort-os-result.json"),"utf8"));
const inst={}; for(const r of rows){const k=gk(r.media,r.country,r.date);inst[k]=(inst[k]||0)+r.install_total;}

const dates=[];for(let t=Date.parse(START+"T00:00:00Z");t<=Date.parse(END+"T00:00:00Z");t+=86400000)dates.push(new Date(t).toISOString().slice(0,10));
function report(name,mediaF,countryF){
  console.log("\n■ "+name+"  (imp/inst = 설치당 광고노출, eCPM = rev/imp*1000)");
  console.log("  date     inst     imp   imp/inst   eCPM    ARPU");
  for(const d of dates){
    let imp=0,rev=0,ins=0;
    for(const r of rows){
      if(r.date!==d)continue; if(mediaF&&r.media!==mediaF)continue; if(countryF&&r.country!==countryF)continue;
      ins+=r.install_total;
      const k=gk(r.media,r.country,d); // add once per unique key
    }
    // imp/rev: iterate B keys matching
    for(const [k,v] of Object.entries(B)){const [m,c,dd]=k.split("|");if(dd!==d)continue;if(mediaF&&m!==mediaF)continue;if(countryF&&c!==countryF)continue;imp+=v.imp;rev+=v.rev;}
    const ipu=ins>0?imp/ins:0, ecpm=imp>0?rev/imp*1000:0, arpu=ins>0?rev/ins:0;
    console.log("  "+d.slice(5)+String(Math.round(ins)).padStart(6)+String(Math.round(imp)).padStart(8)+ipu.toFixed(1).padStart(9)+("$"+ecpm.toFixed(2)).padStart(9)+("$"+arpu.toFixed(3)).padStart(8));
  }
}
report("전체 (7/7~7/19)", null, null);
