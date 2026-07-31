import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";
const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS=["com.albus.idolharvest","id6756664337"];
const START="2026-07-07", END="2026-07-17"; // 완결 코호트
function toKST(ts){if(ts==null)return null;const s=String(ts);const n=s.replace(" ","T")+(s.includes("T")||s.includes("+")?"":"Z");const d=typeof ts==="number"?new Date(ts):new Date(n);return isNaN(d)?null:new Date(d.getTime()+9*3600000).toISOString().slice(0,10);}
function days(a,b){return Math.round((Date.parse(b+"T00:00:00Z")-Date.parse(a+"T00:00:00Z"))/86400000);}
const inR=d=>d>=START&&d<=END;
async function lp(p){const f=[];let t;do{const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,MaxKeys:1000,ContinuationToken:t}));for(const o of (r.Contents||[]))if(o.Size>0&&o.Key.endsWith(".parquet"))f.push(o.Key);t=r.NextContinuationToken;}while(t);return f;}
async function lpre(p){const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,Delimiter:"/",MaxKeys:1000}));return (r.CommonPrefixes||[]).map(x=>x.Prefix);}
async function rp(key,cols){const resp=await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));const ch=[];for await(const c of resp.Body)ch.push(c);const buf=Buffer.concat(ch);const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);const meta=parquetMetadata(ab);const all=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);const idx=cols.map(c=>all.indexOf(c));const rows=[];await parquetRead({file:ab,onComplete:raw=>{for(const row of raw){const o={};cols.forEach((c,i)=>o[c]=idx[i]>=0?row[idx[i]]:null);rows.push(o);}}});return rows;}
async function dts(tbl){const b=`${BASE}t=${tbl}/`;return (await lpre(b)).map(p=>p.replace(b,"").replace(/\/$/,"")).filter(d=>d>="dt=2026-07-06").sort();}

const NET={}, UNIT={}; // key value|date -> {imp,rev}
function add(store,val,d,imp,rev){const k=(val||"(null)")+"|"+d;if(!store[k])store[k]={imp:0,rev:0};store[k].imp+=imp;store[k].rev+=rev;}
for(const tbl of ["attributed_ad_revenue_v2","organic_ad_revenue_v2","retargeting_ad_revenue_v2"]){
  for(const dt of await dts(tbl)){
    const vs=(await lpre(`${BASE}t=${tbl}/${dt}/`)).map(p=>({v:parseInt(p.match(/version=(\d+)/)?.[1]??"-1"),prefix:p})).filter(x=>x.v>=0).sort((a,b)=>b.v-a.v);
    if(!vs.length)continue;
    for(const appId of APP_IDS){
      for(const f of await lp(`${vs[0].prefix}app_id=${appId}/`)){
        for(const r of await rp(f,["event_time","install_time","event_revenue_usd","impressions","monetization_network","ad_unit"])){
          const rev=parseFloat(r.event_revenue_usd)||0; if(rev<=0)continue;
          const ind=toKST(r.install_time); if(!ind||!inR(ind))continue;
          const evd=toKST(r.event_time); if(!evd)continue;
          const dd=Math.max(0,days(ind,evd)); if(dd>1)continue;
          const imp=parseFloat(r.impressions)||0;
          add(NET,r.monetization_network,ind,imp,rev);
          add(UNIT,r.ad_unit,ind,imp,rev);
        }
      }
    }
  }
  process.stderr.write(`${tbl} done\n`);
}
const dates=[];for(let t=Date.parse(START+"T00:00:00Z");t<=Date.parse(END+"T00:00:00Z");t+=86400000)dates.push(new Date(t).toISOString().slice(0,10));
function totals(store){const t={};for(const [k,v] of Object.entries(store)){const val=k.split("|")[0];if(!t[val])t[val]={imp:0,rev:0};t[val].imp+=v.imp;t[val].rev+=v.rev;}return t;}
function report(title,store){
  const tot=totals(store);
  const keys=Object.entries(tot).sort((a,b)=>b[1].rev-a[1].rev).map(x=>x[0]);
  const grand=Object.values(tot).reduce((a,v)=>a+v.rev,0);
  console.log("\n===== "+title+" — 매출 비중 & 전체기간 eCPM =====");
  for(const k of keys){const v=tot[k];const ecpm=v.imp>0?v.rev/v.imp*1000:0;console.log("  "+k.padEnd(22)+"rev $"+v.rev.toFixed(0).padStart(6)+" ("+(v.rev/grand*100).toFixed(1).padStart(4)+"%)  imp "+Math.round(v.imp).toLocaleString().padStart(9)+"  eCPM $"+ecpm.toFixed(2));}
  console.log("\n  --- 일자별 eCPM (상위 매출 항목) ---");
  process.stdout.write("  "+"".padEnd(22));dates.forEach(d=>process.stdout.write(d.slice(5).padStart(7)));console.log();
  for(const k of keys.slice(0,8)){
    process.stdout.write("  "+k.padEnd(22));
    dates.forEach(d=>{const v=store[k+"|"+d];const e=(v&&v.imp>0)?v.rev/v.imp*1000:null;process.stdout.write((e==null?"-":e.toFixed(2)).padStart(7));});
    console.log();
  }
}
report("monetization_network", NET);

// ── ad_unit을 전체 eCPM 기준 티어로 분류해 티어별 일자 추이 ──
const unitTot=totals(UNIT);
function tier(u){const e=unitTot[u]&&unitTot[u].imp>0?unitTot[u].rev/unitTot[u].imp*1000:0;
  if(e<2)return "배너(eCPM<$2)"; if(e<80)return "리워드/전면($2~80)"; return "고단가($80+)";}
const TIER={};
for(const [k,v] of Object.entries(UNIT)){const [u,d]=k.split("|");const t=tier(u)+"|"+d;if(!TIER[t])TIER[t]={imp:0,rev:0};TIER[t].imp+=v.imp;TIER[t].rev+=v.rev;}
console.log("\n===== ad_unit 티어별 =====");
const dts2=dates;
for(const label of ["배너(eCPM<$2)","리워드/전면($2~80)","고단가($80+)"]){
  console.log("\n■ "+label);
  console.log("  date      imp        rev      eCPM");
  for(const d of dts2){const v=TIER[label+"|"+d];if(!v){console.log("  "+d.slice(5));continue;}const e=v.imp>0?v.rev/v.imp*1000:0;console.log("  "+d.slice(5)+String(Math.round(v.imp)).padStart(9)+("$"+v.rev.toFixed(0)).padStart(8)+("$"+e.toFixed(2)).padStart(9));}
}
// 티어별 매출 비중(일자별) — 믹스 변화 확인
console.log("\n===== 매출 비중(%) 일자별: 믹스 변화 =====");
process.stdout.write("  "+"".padEnd(20));dts2.forEach(d=>process.stdout.write(d.slice(5).padStart(7)));console.log();
for(const label of ["배너(eCPM<$2)","리워드/전면($2~80)","고단가($80+)"]){
  process.stdout.write("  "+label.padEnd(20));
  dts2.forEach(d=>{let tot=0,part=0;for(const L of ["배너(eCPM<$2)","리워드/전면($2~80)","고단가($80+)"]){const v=TIER[L+"|"+d];if(v)tot+=v.rev;if(L===label&&v)part=v.rev;}process.stdout.write((tot>0?(part/tot*100).toFixed(0)+"%":"-").padStart(7));});
  console.log();
}
