import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";
import { readFileSync } from "fs";
import { dataPath } from "./paths.mjs";
const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS=["com.albus.idolharvest","id6756664337"];
const START="2026-07-07", END="2026-07-17";
function toKST(ts){if(ts==null)return null;const s=String(ts);const n=s.replace(" ","T")+(s.includes("T")||s.includes("+")?"":"Z");const d=typeof ts==="number"?new Date(ts):new Date(n);return isNaN(d)?null:new Date(d.getTime()+9*3600000).toISOString().slice(0,10);}
function days(a,b){return Math.round((Date.parse(b+"T00:00:00Z")-Date.parse(a+"T00:00:00Z"))/86400000);}
const inR=d=>d>=START&&d<=END;
async function lp(p){const f=[];let t;do{const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,MaxKeys:1000,ContinuationToken:t}));for(const o of (r.Contents||[]))if(o.Size>0&&o.Key.endsWith(".parquet"))f.push(o.Key);t=r.NextContinuationToken;}while(t);return f;}
async function lpre(p){const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,Delimiter:"/",MaxKeys:1000}));return (r.CommonPrefixes||[]).map(x=>x.Prefix);}
async function rp(key,cols){const resp=await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));const ch=[];for await(const c of resp.Body)ch.push(c);const buf=Buffer.concat(ch);const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);const meta=parquetMetadata(ab);const all=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);const idx=cols.map(c=>all.indexOf(c));const rows=[];await parquetRead({file:ab,onComplete:raw=>{for(const row of raw){const o={};cols.forEach((c,i)=>o[c]=idx[i]>=0?row[idx[i]]:null);rows.push(o);}}});return rows;}
async function dts(tbl){const b=`${BASE}t=${tbl}/`;return (await lpre(b)).map(p=>p.replace(b,"").replace(/\/$/,"")).filter(d=>d>="dt=2026-07-06").sort();}
// 형식 그룹핑: INTER류(전면 고단가), CTD(교차프로모), 기타
function fmt(t){t=t||"(null)";if(t==="INTER"||t==="interstitial"||t==="(null)"||t==="video"||t==="rewarded_video")return "전면/리워드(고단가)";if(t==="ClickToDownload")return "CTD(교차프로모)";if(t==="banner"||t==="native")return "배너/네이티브";return "SNS(reels/stories)";}

// key adtypeGroup|media|country|date -> rev
const R={};
const add=(k,rev)=>{R[k]=(R[k]||0)+rev;};
for(const tbl of ["attributed_ad_revenue_v2","organic_ad_revenue_v2","retargeting_ad_revenue_v2"]){
  for(const dt of await dts(tbl)){
    const vs=(await lpre(`${BASE}t=${tbl}/${dt}/`)).map(p=>({v:parseInt(p.match(/version=(\d+)/)?.[1]??"-1"),prefix:p})).filter(x=>x.v>=0).sort((a,b)=>b.v-a.v);
    if(!vs.length)continue;
    for(const appId of APP_IDS){
      for(const f of await lp(`${vs[0].prefix}app_id=${appId}/`)){
        for(const r of await rp(f,["event_time","install_time","event_revenue_usd","media_source","country_code","af_ad_type"])){
          const rev=parseFloat(r.event_revenue_usd)||0; if(rev<=0)continue;
          const ind=toKST(r.install_time); if(!ind||!inR(ind))continue;
          const dd=Math.max(0,days(ind,toKST(r.event_time))); if(dd>1)continue;
          add(fmt(r.af_ad_type)+"|"+(r.media_source||"organic")+"|"+(r.country_code||"?")+"|"+ind, rev);
        }
      }
    }
  }
  process.stderr.write(`${tbl} done\n`);
}
const rows=JSON.parse(readFileSync(dataPath("geo-cohort-os-result.json"),"utf8"));
const instBy=(keyf)=>{const m={};for(const r of rows){if(r.date<START||r.date>END)continue;const k=keyf(r);m[k]=(m[k]||0)+r.install_total;}return m;};
const dates=[];for(let t=Date.parse(START+"T00:00:00Z");t<=Date.parse(END+"T00:00:00Z");t+=86400000)dates.push(new Date(t).toISOString().slice(0,10));

// 1) 형식별 × 일자: D1 IAA 매출
function sumR(pred){const m={};for(const [k,v] of Object.entries(R)){const[fg,me,co,d]=k.split("|");if(!pred(fg,me,co,d))continue;m[d]=(m[d]||0)+v;}return m;}
const fmts=["전면/리워드(고단가)","CTD(교차프로모)","SNS(reels/stories)","배너/네이티브"];
console.log("=== 형식별 D1 IAA 매출($) × 설치일 ===");
process.stdout.write("형식".padEnd(22));dates.forEach(d=>process.stdout.write(d.slice(5).padStart(7)));console.log();
for(const fg of fmts){process.stdout.write(fg.padEnd(20));dates.forEach(d=>{const m=sumR((f,me,co,dd)=>f===fg&&dd===d);process.stdout.write(String(Math.round(m[d]||0)).padStart(7));});console.log();}

// 2) 고단가 형식만: 매체 × 일자
console.log("\n=== '전면/리워드(고단가)' D1 IAA 매출($): 매체 × 설치일 ===");
process.stdout.write("매체".padEnd(22));dates.forEach(d=>process.stdout.write(d.slice(5).padStart(7)));console.log();
for(const me of ["Facebook Ads","googleadwords_int","applovin_int","liftoff_int","organic"]){
  process.stdout.write(me.padEnd(20));dates.forEach(d=>{let s=0;for(const[k,v]of Object.entries(R)){const[fg,m,co,dd]=k.split("|");if(fg==="전면/리워드(고단가)"&&m===me&&dd===d)s+=v;}process.stdout.write(String(Math.round(s)).padStart(7));});console.log();
}
// 3) 고단가 형식만: 국가 × 일자 (상위국가)
console.log("\n=== '전면/리워드(고단가)' D1 IAA 매출($): 국가 × 설치일 ===");
process.stdout.write("국가".padEnd(22));dates.forEach(d=>process.stdout.write(d.slice(5).padStart(7)));console.log();
for(const co of ["US","KR","JP"]){
  process.stdout.write(co.padEnd(20));dates.forEach(d=>{let s=0;for(const[k,v]of Object.entries(R)){const[fg,m,c,dd]=k.split("|");if(fg==="전면/리워드(고단가)"&&c===co&&dd===d)s+=v;}process.stdout.write(String(Math.round(s)).padStart(7));});console.log();
}
