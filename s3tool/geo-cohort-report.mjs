import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";
import { writeFileSync } from "fs";

const BASE   = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];

// 코호트(install_date) 대상: 7/7~7/13 KST
const TARGET_KST = ["2026-07-07","2026-07-08","2026-07-09","2026-07-10","2026-07-11","2026-07-12","2026-07-13"];
function inRange(kd){ return TARGET_KST.includes(kd); }

function toKSTDate(ts) {
  if (ts==null) return null;
  const s = String(ts);
  const norm = s.replace(" ","T") + (s.includes("T")||s.includes("+")?"":"Z");
  const d = typeof ts==="number" ? new Date(ts) : new Date(norm);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime()+9*3600000).toISOString().slice(0,10);
}
function daysBetween(d1, d2){ // d2 - d1 (in days), both "YYYY-MM-DD"
  return Math.round((Date.parse(d2+"T00:00:00Z") - Date.parse(d1+"T00:00:00Z"))/86400000);
}

async function listParquet(prefix){
  const files=[]; let token;
  do{
    const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:prefix,MaxKeys:1000,ContinuationToken:token}));
    for(const o of (r.Contents||[])) if(o.Size>0&&o.Key.endsWith(".parquet")) files.push(o.Key);
    token=r.NextContinuationToken;
  }while(token);
  return files;
}
async function listPrefixes(prefix){
  const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:prefix,Delimiter:"/",MaxKeys:1000}));
  return (r.CommonPrefixes||[]).map(p=>p.Prefix);
}
async function readParquet(key, wantCols){
  const resp=await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));
  const chunks=[]; for await (const c of resp.Body) chunks.push(c);
  const buf=Buffer.concat(chunks);
  const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
  const meta=parquetMetadata(ab);
  const allCols=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);
  const idx=wantCols.map(c=>allCols.indexOf(c));
  const rows=[];
  await parquetRead({file:ab, onComplete: raw=>{
    for(const row of raw){ const o={}; wantCols.forEach((c,i)=>o[c]=idx[i]>=0?row[idx[i]]:null); rows.push(o); }
  }});
  return rows;
}
// dt= 아래 사용 가능한 dt 목록
async function dtList(tbl, minDt){
  const base=`${BASE}t=${tbl}/`;
  const ps=await listPrefixes(base);
  return ps.map(p=>p.replace(base,"").replace(/\/$/,"")).filter(dt=>dt>=minDt).sort();
}

// ── 저장소 ──
// daily: media|country|date -> {ir,is,cost,imp,clk,rev_iap,rev_iaa}  (date=calendar KST)
// cohort: media|country|cohortDate -> {installs, cost, d1, d3}  (cohortDate=install_date KST)
const daily = {};
const cohort = {};
const SEP="";
function dkey(m,c,d){return m+SEP+c+SEP+d;}
function dget(store,m,c,d,init){ const k=dkey(m,c,d); if(!store[k]) store[k]={media:m,country:c,date:d,...init()}; return store[k]; }
const dinit=()=>({ir:0,is:0,cost:0,imp:0,clk:0,rev_iap:0,rev_iaa:0});
const cinit=()=>({ir:0,is:0,cost:0,d1_iap:0,d1_iaa:0,d3_iap:0,d3_iaa:0});

// ══ 1. COST (geo) — 각 date는 그 date 포함 최신 dt=의 최대 v= 에서 ══
process.stderr.write("[1] cost_etl_summary (geo)\n");
{
  const base=`${BASE}t=cost_etl_summary/`;
  const dts=(await listPrefixes(base)).map(p=>p.replace(base,"").replace(/\/$/,"").replace("dt=","")).sort();
  const byDt={}; // dt -> { media|country|date -> {cost,imp,clk} }
  for(const dt of dts){
    const vs=(await listPrefixes(`${base}dt=${dt}/`))
      .map(p=>({v:parseInt(p.match(/v=(\d+)/)?.[1]??"-1"),prefix:p})).filter(x=>x.v>=0).sort((a,b)=>b.v-a.v);
    if(!vs.length) continue;
    const agg={};
    for(const f of await listParquet(vs[0].prefix)){
      const rows=await readParquet(f,["app_id","media_source","date","geo","cost","impressions","clicks"]);
      for(const r of rows){
        if(!APP_IDS.includes(r.app_id)) continue;
        const kd=r.date?String(r.date).slice(0,10):null;
        if(!kd||!inRange(kd)) continue;
        const m=r.media_source||"organic", c=r.geo||"??";
        const k=dkey(m,c,kd);
        if(!agg[k]) agg[k]={cost:0,imp:0,clk:0};
        agg[k].cost+=parseFloat(r.cost)||0; agg[k].imp+=parseFloat(r.impressions)||0; agg[k].clk+=parseFloat(r.clicks)||0;
      }
    }
    byDt[dt]=agg;
    process.stderr.write(`  cost dt=${dt} (v=${vs[0].v}) keys=${Object.keys(agg).length}\n`);
  }
  // 각 key에 대해 최신 dt 값 채택
  const final={};
  for(const dt of dts.slice().sort()) for(const [k,v] of Object.entries(byDt[dt]||{})) final[k]=v;
  for(const [k,v] of Object.entries(final)){
    const [m,c,d]=k.split(SEP);
    const e=dget(daily,m,c,d,dinit); e.cost+=v.cost; e.imp+=v.imp; e.clk+=v.clk;
    const ce=dget(cohort,m,c,d,cinit); ce.cost+=v.cost;
  }
}

// ══ 2. 일반 installs (country_code) ══
process.stderr.write("[2] installs\n");
{
  const dts=await dtList("installs","dt=2026-07-06");
  for(const dt of dts){
    for(const hp of await listPrefixes(`${BASE}t=installs/${dt}/`)){
      for(const appId of APP_IDS){
        for(const f of await listParquet(`${hp}app_id=${appId}/`)){
          const rows=await readParquet(f,["install_time","media_source","country_code"]);
          for(const r of rows){
            const kd=toKSTDate(r.install_time);
            if(!kd||!inRange(kd)) continue;
            const m=r.media_source||"organic", c=r.country_code||"??";
            dget(daily,m,c,kd,dinit).ir++;
            dget(cohort,m,c,kd,cinit).ir++;
          }
        }
      }
    }
    process.stderr.write(`  installs ${dt} done\n`);
  }
}

// ══ 3. skad installs (flag≠true, country_code) — 전 dt 합산 ══
process.stderr.write("[3] skad_installs\n");
{
  const dts=await dtList("skad_installs","dt=2026-07-06");
  for(const dt of dts){
    for(const hp of await listPrefixes(`${BASE}t=skad_installs/${dt}/`)){
      for(const appId of APP_IDS){
        for(const f of await listParquet(`${hp}app_id=${appId}/`)){
          const rows=await readParquet(f,["install_date","media_source","af_attribution_flag","country_code"]);
          for(const r of rows){
            if(String(r.af_attribution_flag).toLowerCase()==="true") continue;
            const kd=r.install_date?String(r.install_date).slice(0,10):null;
            if(!kd||!inRange(kd)) continue;
            const m=r.media_source||"unknown", c=r.country_code||"??";
            dget(daily,m,c,kd,dinit).is++;
            dget(cohort,m,c,kd,cinit).is++;
          }
        }
      }
    }
    process.stderr.write(`  skad ${dt} done\n`);
  }
}

// ══ 4. REVENUE 이벤트 (IAP + IAA) — daily(calendar) + cohort(D1/D3) ══
// IAP: inapps af_purchase (version 없음, h= 시간별)
// IAA: *_ad_revenue_v2 (dt= 안 최대 version만)
process.stderr.write("[4] revenue events\n");
function applyRevenue(r, kind){
  const rev=parseFloat(r.event_revenue_usd)||0;
  if(rev<=0) return;
  const evd=toKSTDate(r.event_time), ind=toKSTDate(r.install_time);
  const m=r.media_source||"organic", c=r.country_code||"??";
  // daily calendar revenue (event 날짜 기준, 대상기간 내)
  if(evd&&inRange(evd)){
    const e=dget(daily,m,c,evd,dinit);
    if(kind==="iap") e.rev_iap+=rev; else e.rev_iaa+=rev;
  }
  // cohort: install_date가 대상기간, days_since>=0
  if(ind&&inRange(ind)&&evd){
    const dd=daysBetween(ind,evd);
    if(dd>=0){
      const ce=dget(cohort,m,c,ind,cinit);
      if(dd<=1){ if(kind==="iap") ce.d1_iap+=rev; else ce.d1_iaa+=rev; }
      if(dd<=3){ if(kind==="iap") ce.d3_iap+=rev; else ce.d3_iaa+=rev; }
    }
  }
}
// IAP
{
  const dts=await dtList("inapps","dt=2026-07-06");
  for(const dt of dts){
    for(const hp of await listPrefixes(`${BASE}t=inapps/${dt}/`)){
      for(const appId of APP_IDS){
        for(const f of await listParquet(`${hp}app_id=${appId}/`)){
          const rows=await readParquet(f,["event_time","install_time","event_name","event_revenue_usd","media_source","country_code"]);
          for(const r of rows){ if(r.event_name==="af_purchase") applyRevenue(r,"iap"); }
        }
      }
    }
    process.stderr.write(`  inapps ${dt} done\n`);
  }
}
// IAA
for(const tbl of ["attributed_ad_revenue_v2","organic_ad_revenue_v2","retargeting_ad_revenue_v2"]){
  const dts=await dtList(tbl,"dt=2026-07-06");
  for(const dt of dts){
    const vs=(await listPrefixes(`${BASE}t=${tbl}/${dt}/`))
      .map(p=>({v:parseInt(p.match(/version=(\d+)/)?.[1]??"-1"),prefix:p})).filter(x=>x.v>=0).sort((a,b)=>b.v-a.v);
    if(!vs.length) continue;
    for(const appId of APP_IDS){
      for(const f of await listParquet(`${vs[0].prefix}app_id=${appId}/`)){
        const rows=await readParquet(f,["event_time","install_time","event_revenue_usd","media_source","country_code"]);
        for(const r of rows) applyRevenue(r,"iaa");
      }
    }
    process.stderr.write(`  ${tbl} ${dt} (v=${vs[0].v}) done\n`);
  }
}

// ══ BUILD OUTPUT ══
const dailyOut=[];
for(const e of Object.values(daily)){
  const installs=e.ir+e.is, revenue=e.rev_iap+e.rev_iaa;
  dailyOut.push({
    date:e.date, media:e.media, country:e.country,
    installs_reg:e.ir, installs_skad:e.is, installs,
    impressions:Math.round(e.imp), clicks:Math.round(e.clk), cost:+e.cost.toFixed(4),
    rev_iap:+e.rev_iap.toFixed(4), rev_iaa:+e.rev_iaa.toFixed(4), revenue:+revenue.toFixed(4),
    cpi: e.cost>0&&installs>0?+(e.cost/installs).toFixed(2):null,
    roas: e.cost>0&&revenue>0?+(revenue/e.cost*100).toFixed(2):null,
  });
}
const cohortOut=[];
for(const e of Object.values(cohort)){
  const installs=e.ir+e.is;
  const d1=e.d1_iap+e.d1_iaa, d3=e.d3_iap+e.d3_iaa;
  cohortOut.push({
    cohort_date:e.date, media:e.media, country:e.country,
    installs, cost:+e.cost.toFixed(4),
    rev_d1:+d1.toFixed(4), rev_d3:+d3.toFixed(4),
    rev_d1_iap:+e.d1_iap.toFixed(4), rev_d1_iaa:+e.d1_iaa.toFixed(4),
    rev_d3_iap:+e.d3_iap.toFixed(4), rev_d3_iaa:+e.d3_iaa.toFixed(4),
    roas_d1: e.cost>0&&d1>0?+(d1/e.cost*100).toFixed(2):null,
    roas_d3: e.cost>0&&d3>0?+(d3/e.cost*100).toFixed(2):null,
  });
}
dailyOut.sort((a,b)=>a.date.localeCompare(b.date)||a.media.localeCompare(b.media)||b.revenue-a.revenue);
cohortOut.sort((a,b)=>a.cohort_date.localeCompare(b.cohort_date)||a.media.localeCompare(b.media)||b.rev_d3-a.rev_d3);

writeFileSync("C:/Users/STZ940/s3tool/geo-cohort-result.json", JSON.stringify({daily:dailyOut,cohort:cohortOut},null,2),"utf8");
process.stderr.write(`\nDone! daily=${dailyOut.length} cohort=${cohortOut.length} rows\n`);
process.stdout.write(`daily rows: ${dailyOut.length}, cohort rows: ${cohortOut.length}\n`);
// 국가 요약
const byC={};
for(const r of dailyOut){ byC[r.country]=(byC[r.country]||0)+r.revenue; }
process.stdout.write("매출 상위 국가:\n");
Object.entries(byC).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([c,v])=>process.stdout.write(`  ${c}: $${v.toFixed(2)}\n`));
