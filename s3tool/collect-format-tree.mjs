import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";
import { writeFileSync } from "fs";
import { dataPath } from "./paths.mjs";
import { START, END, END_SOURCE } from "./run-window.mjs";
const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS=["com.albus.idolharvest","id6756664337"];
// 대상 기간은 run-window.mjs가 정하며 geo-cohort-os.mjs와 공유한다.
process.stderr.write(`대상 기간: ${START} ~ ${END} (종료일: ${END_SOURCE})\n`);
function toKST(ts){if(ts==null)return null;const s=String(ts);const n=s.replace(" ","T")+(s.includes("T")||s.includes("+")?"":"Z");const d=typeof ts==="number"?new Date(ts):new Date(n);return isNaN(d)?null:new Date(d.getTime()+9*3600000).toISOString().slice(0,10);}
function days(a,b){return Math.round((Date.parse(b+"T00:00:00Z")-Date.parse(a+"T00:00:00Z"))/86400000);}
const inR=d=>d>=START&&d<=END;
async function lp(p){const f=[];let t;do{const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,MaxKeys:1000,ContinuationToken:t}));for(const o of (r.Contents||[]))if(o.Size>0&&o.Key.endsWith(".parquet"))f.push(o.Key);t=r.NextContinuationToken;}while(t);return f;}
async function lpre(p){const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p,Delimiter:"/",MaxKeys:1000}));return (r.CommonPrefixes||[]).map(x=>x.Prefix);}
async function rp(key,cols){const resp=await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));const ch=[];for await(const c of resp.Body)ch.push(c);const buf=Buffer.concat(ch);const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);const meta=parquetMetadata(ab);const all=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);const idx=cols.map(c=>all.indexOf(c));const rows=[];await parquetRead({file:ab,onComplete:raw=>{for(const row of raw){const o={};cols.forEach((c,i)=>o[c]=idx[i]>=0?row[idx[i]]:null);rows.push(o);}}});return rows;}
async function dts(tbl){const b=`${BASE}t=${tbl}/`;return (await lpre(b)).map(p=>p.replace(b,"").replace(/\/$/,"")).filter(d=>d>="dt=2026-07-06").sort();}
const TABLES=["attributed_ad_revenue_v2","organic_ad_revenue_v2","retargeting_ad_revenue_v2"];

// 일반(non-SKAN) 귀속용(사용자 요청): 캠페인명에 kr/us/jp 등 명확한 국가코드가 있으면 그 코드를 우선 사용한다.
// AppsFlyer raw country_code가 실제 타겟 국가와 어긋나는 오귀속(예: us 캠페인인데 country_code=DE로 잡혀
// 실제로 광고를 집행하지 않은 DE로 잘못 귀속되는 문제)를 캠페인명이 명확할 때는 캠페인명으로 바로잡기 위함.
// "ww"처럼 국가를 특정할 수 없는 캠페인(및 organic/미기재)은 null을 반환해 호출측이 raw country_code로 폴백한다.
function campCountryStrict(name){
  const parts=String(name||"").split("_");
  const i=parts.indexOf("if");
  const tok=(i>=0?parts[i+1]:parts[2])||"";
  const m=tok.match(/^[a-z]+/i);
  const code=m?m[0].toUpperCase():null;
  return (code&&code!=="WW")?code:null;
}

// 형식 라벨링: placement(가장 구체) → af_ad_type. 결정 불가면 null 반환.
function fmtLabel(placement,t){
  const p=(placement||"").toLowerCase();
  if(p){
    if(/(^rv_|rewarded|_money)/.test(p))return "리워드(Rewarded)";
    if(/(^inter|interstitial|appopen)/.test(p))return "전면(Interstitial)";
    if(/(banner|mrec)/.test(p))return "배너(Banner)";
    if(/native/.test(p))return "네이티브(Native)";
  }
  if(t&&t!==""){
    if(t==="ClickToDownload")return "CTD/Google";
    if(t==="INTER"||t==="interstitial"||t==="video")return "전면(Interstitial)";
    if(t==="rewarded_video")return "리워드(Rewarded)";
    if(t==="banner")return "배너(Banner)";
    if(t==="native")return "네이티브(Native)";
    if(t==="instagram_reels"||t==="instagram_stories")return "SNS(Reels/Stories)";
  }
  return null;
}

// ── PASS 1: ad_unit → 지배 형식 매핑 (라벨 가능한 레코드의 매출 기준 argmax; CTD/Google 제외=MAX 유닛만) ──
process.stderr.write(`[pass1] ad_unit→형식 매핑 구축 (${START}~${END})\n`);
const unitRev={}; // ad_unit -> {fmt: rev}
for(const tbl of TABLES){
  for(const dt of await dts(tbl)){
    const vs=(await lpre(`${BASE}t=${tbl}/${dt}/`)).map(p=>({v:parseInt(p.match(/version=(\d+)/)?.[1]??"-1"),prefix:p})).filter(x=>x.v>=0).sort((a,b)=>b.v-a.v);
    if(!vs.length)continue;
    for(const app of APP_IDS){
      for(const f of await lp(`${vs[0].prefix}app_id=${app}/`)){
        for(const r of await rp(f,["event_revenue_usd","placement","af_ad_type","ad_unit"])){
          const rev=parseFloat(r.event_revenue_usd)||0; if(rev<=0)continue;
          const u=r.ad_unit; if(!u)continue;
          const l=fmtLabel(r.placement,r.af_ad_type); if(!l||l==="CTD/Google")continue;
          (unitRev[u]=unitRev[u]||{})[l]=(unitRev[u][l]||0)+rev;
        }
      }
    }
  }
  process.stderr.write(`  pass1 ${tbl} done\n`);
}
const unitMap={}; // ad_unit -> 지배 형식
for(const [u,m] of Object.entries(unitRev)){unitMap[u]=Object.entries(m).sort((a,b)=>b[1]-a[1])[0][0];}
process.stderr.write(`  매핑된 ad_unit: ${Object.keys(unitMap).length}개\n`);

// 최종 형식 결정: ① placement/af_ad_type 라벨 → ② ad_unit 지배형식 추정 → ③ 기타/미상
function classify(r){
  const l=fmtLabel(r.placement,r.af_ad_type); if(l)return l;
  if(r.ad_unit&&unitMap[r.ad_unit])return unitMap[r.ad_unit];
  return "기타/미상";
}

// ── PASS 2: 코호트 D0/D1/D3/D7 집계 (date|country|format|media) ──
process.stderr.write("[pass2] 코호트 집계\n");
const R={};
function g(d,c,fm,m){const k=[d,c,fm,m].join("|||");if(!R[k])R[k]={date:d,country:c,format:fm,media:m,d0:0,d1:0,d3:0,d7:0,imp1:0};return R[k];}
for(const tbl of TABLES){
  for(const dt of await dts(tbl)){
    const vs=(await lpre(`${BASE}t=${tbl}/${dt}/`)).map(p=>({v:parseInt(p.match(/version=(\d+)/)?.[1]??"-1"),prefix:p})).filter(x=>x.v>=0).sort((a,b)=>b.v-a.v);
    if(!vs.length)continue;
    for(const app of APP_IDS){
      for(const f of await lp(`${vs[0].prefix}app_id=${app}/`)){
        for(const r of await rp(f,["event_time","install_time","event_revenue_usd","media_source","country_code","af_ad_type","placement","ad_unit","impressions","campaign"])){
          const rev=parseFloat(r.event_revenue_usd)||0; if(rev<=0)continue;
          const ind=toKST(r.install_time); if(!ind||!inR(ind))continue;
          const dd=Math.max(0,days(ind,toKST(r.event_time)));
          const e=g(ind, campCountryStrict(r.campaign)||(r.country_code||"(미상)"), classify(r), r.media_source||"organic");
          const imp=parseFloat(r.impressions)||0;
          if(dd===0){e.d0+=rev;}
          if(dd<=1){e.d1+=rev;e.imp1+=imp;}
          if(dd<=3){e.d3+=rev;}
          if(dd<=7){e.d7+=rev;}
        }
      }
    }
  }
  process.stderr.write(`  pass2 ${tbl} done\n`);
}
const out=Object.values(R).map(e=>({...e,d0:+e.d0.toFixed(2),d1:+e.d1.toFixed(2),d3:+e.d3.toFixed(2),d7:+e.d7.toFixed(2),imp1:Math.round(e.imp1),ecpm1:e.imp1>0?+(e.d1/e.imp1*1000).toFixed(2):null}));
out.sort((a,b)=>a.date.localeCompare(b.date)||b.d1-a.d1);

// ── PASS 3: 설치 수 (date|country|media) — 유저당 LTV 분모. format 차원은 없음(설치는 형식과 무관). ──
process.stderr.write("[pass3] 설치 수 집계 (LTV 분모)\n");
const INST={};
function gi(d,c,m){const k=[d,c,m].join("|||");if(!INST[k])INST[k]={date:d,country:c,media:m,installs:0};return INST[k];}
function campCountrySK(name){const parts=String(name||"").split("_");const i=parts.indexOf("if");const tok=(i>=0?parts[i+1]:parts[2])||"";const mm=tok.match(/^[a-z]+/i);return mm?mm[0].toUpperCase():"??";}
for(const dt of await dts("installs")){
  for(const hp of await lpre(`${BASE}t=installs/${dt}/`)){
    for(const app of APP_IDS){
      for(const f of await lp(`${hp}app_id=${app}/`)){
        for(const r of await rp(f,["install_time","media_source","country_code","campaign"])){
          const kd=toKST(r.install_time); if(!kd||!inR(kd))continue;
          gi(kd,campCountryStrict(r.campaign)||(r.country_code||"(미상)"),r.media_source||"organic").installs++;
        }
      }
    }
  }
  process.stderr.write(`  installs ${dt}\n`);
}
for(const dt of await dts("skad_installs")){
  for(const hp of await lpre(`${BASE}t=skad_installs/${dt}/`)){
    for(const app of APP_IDS){
      for(const f of await lp(`${hp}app_id=${app}/`)){
        for(const r of await rp(f,["install_date","media_source","af_attribution_flag","ad_network_campaign_name"])){
          if(String(r.af_attribution_flag).toLowerCase()==="true")continue;
          const kd=r.install_date?String(r.install_date).slice(0,10):null; if(!kd||!inR(kd))continue;
          gi(kd,campCountrySK(r.ad_network_campaign_name),r.media_source||"unknown").installs++;
        }
      }
    }
  }
  process.stderr.write(`  skad_installs ${dt}\n`);
}
const instOut=Object.values(INST);

writeFileSync(dataPath("format-tree-result.json"), JSON.stringify({rows:out,installs:instOut},null,2),"utf8");
process.stdout.write(`rows: ${out.length}\n`);
const byF={};for(const r of out)byF[r.format]=(byF[r.format]||0)+r.d1;
let t0=0,t1=0,t3=0,t7=0;for(const r of out){t0+=r.d0;t1+=r.d1;t3+=r.d3;t7+=r.d7;}
let totalInst=0;for(const i of instOut)totalInst+=i.installs;
process.stdout.write(`총 D1 IAA: $${t1.toFixed(0)}\n형식별 D1:\n`);
for(const [k,v] of Object.entries(byF).sort((a,b)=>b[1]-a[1]))process.stdout.write(`  ${k.padEnd(22)}$${v.toFixed(0)}\n`);
process.stdout.write(`\n설치 수(LTV 분모): ${totalInst}\n`);
process.stdout.write(`유저당 IAA LTV: D0=$${(totalInst>0?t0/totalInst:0).toFixed(3)} D1=$${(totalInst>0?t1/totalInst:0).toFixed(3)} D3=$${(totalInst>0?t3/totalInst:0).toFixed(3)} D7=$${(totalInst>0?t7/totalInst:0).toFixed(3)}\n`);
