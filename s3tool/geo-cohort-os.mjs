import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";
import { writeFileSync, readFileSync, renameSync } from "fs";
import { dataPath } from "./paths.mjs";

const BASE   = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const OS_OF = { "com.albus.idolharvest":"Android", "id6756664337":"iOS" };
const APP_IDS = Object.keys(OS_OF);

// 대상 기간: 2026-07-07 ~ 전일(KST). 매일 실행 시 종료일이 자동으로 하루씩 늘어남.
const START="2026-07-07";
const kstNow=new Date(Date.now()+9*3600000);
const endStr=new Date(kstNow.getTime()-24*3600000).toISOString().slice(0,10); // 어제(KST)
const TARGET_KST=[];
for(let t=Date.parse(START+"T00:00:00Z"); t<=Date.parse(endStr+"T00:00:00Z"); t+=86400000){
  TARGET_KST.push(new Date(t).toISOString().slice(0,10));
}
process.stderr.write(`대상 코호트: ${START} ~ ${endStr} (${TARGET_KST.length}일)\n`);
const inRange = kd => TARGET_KST.includes(kd);

function toKSTDate(ts){ if(ts==null)return null; const s=String(ts); const norm=s.replace(" ","T")+(s.includes("T")||s.includes("+")?"":"Z"); const d=typeof ts==="number"?new Date(ts):new Date(norm); return isNaN(d.getTime())?null:new Date(d.getTime()+9*3600000).toISOString().slice(0,10); }
function daysBetween(d1,d2){ return Math.round((Date.parse(d2+"T00:00:00Z")-Date.parse(d1+"T00:00:00Z"))/86400000); }
// parquet 정수 컬럼(impressions/clicks 등)은 BigInt로 올 수 있어 안전 변환
function num(v){ return v==null?0:(typeof v==="bigint"?Number(v):(parseFloat(v)||0)); }

async function listParquet(prefix){const files=[];let token;do{const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:prefix,MaxKeys:1000,ContinuationToken:token}));for(const o of (r.Contents||[]))if(o.Size>0&&o.Key.endsWith(".parquet"))files.push(o.Key);token=r.NextContinuationToken;}while(token);return files;}
async function listPrefixes(prefix){const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:prefix,Delimiter:"/",MaxKeys:1000}));return (r.CommonPrefixes||[]).map(p=>p.Prefix);}
async function readParquet(key,wantCols){const resp=await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));const chunks=[];for await(const c of resp.Body)chunks.push(c);const buf=Buffer.concat(chunks);const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);const meta=parquetMetadata(ab);const allCols=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);const present=wantCols.filter(c=>allCols.includes(c));const rows=[];await parquetRead({file:ab,metadata:meta,columns:present,rowFormat:"object",onComplete:raw=>{for(const row of raw){const o={};for(const c of wantCols)o[c]=present.includes(c)?row[c]:null;rows.push(o);}}});return rows;}
async function dtList(tbl,minDt){const base=`${BASE}t=${tbl}/`;const ps=await listPrefixes(base);return ps.map(p=>p.replace(base,"").replace(/\/$/,"")).filter(dt=>dt>=minDt).sort();}

// key: media|||country|||os|||campaign|||date(=install/cohort date)
const R={};
const K=(m,c,o,camp,d)=>`${m}|||${c}|||${o}|||${camp}|||${d}`;
function get(m,c,o,camp,d){const k=K(m,c,o,camp,d);if(!R[k])R[k]={media:m,country:c,os:o,campaign:camp,date:d,ir:0,is:0,cost:0,imp:0,clk:0,d1_iap:0,d1_iaa:0,d3_iap:0,d3_iaa:0,d7_iap:0,d7_iaa:0,d14_iap:0,d14_iaa:0,d21_iap:0,d21_iaa:0,d30_iap:0,d30_iaa:0,skan_rev:0,pur_d1:new Set(),pur_d3:new Set(),rr1_users:0,rr3_users:0,rr7_users:0,rr30_users:0};return R[k];}

// ══ 소재(creative) 뎁스 추가용 보조 누적기(RC, 사용자 요청) ══
// 기존 R(일자별, 소재 없음)은 완전히 그대로 두고 — Summary/Cohort Trend 탭과 매일 스케줄
// 갱신에 영향 없음 — 캠페인 하위에 소재까지 분해한 뷰만 별도로 추가한다. 소재를 추가하면
// 캠페인×소재×일자 조합이 크게 늘어나므로, 이 누적기만 일자 대신 "주차"(캠페인 시작일
// 2026-07-07부터 7일 단위)로 묶어 데이터량을 줄인다. Day-N 코호트 판정(dd)은 항상 실제
// 설치일 기준으로 계산한 뒤 그 결과를 주차 버킷에 합산하므로 정확도 손실은 없다.
const RC={};
const KC=(m,c,o,camp,cre,w)=>`${m}|||${c}|||${o}|||${camp}|||${cre}|||${w}`;
function getC(m,c,o,camp,cre,w){const k=KC(m,c,o,camp,cre,w);if(!RC[k])RC[k]={media:m,country:c,os:o,campaign:camp,creative:cre,week:w,ir:0,is:0,cost:0,imp:0,clk:0,d1_iap:0,d1_iaa:0,d3_iap:0,d3_iaa:0,d7_iap:0,d7_iaa:0,d14_iap:0,d14_iaa:0,d21_iap:0,d21_iaa:0,d30_iap:0,d30_iaa:0,skan_rev:0,pur_d1:new Set(),pur_d3:new Set(),rr1_users:0,rr3_users:0,rr7_users:0,rr30_users:0};return RC[k];}
const START_T=Date.parse(START+"T00:00:00Z");
const END_T=Date.parse(endStr+"T00:00:00Z");
// 주차 라벨: "MM/DD~MM/DD" (버킷 끝이 아직 도래하지 않았으면 실제 데이터 마지막 날짜까지만 표시)
function weekLabel(dateStr){
  const t=Date.parse(dateStr+"T00:00:00Z");
  const idx=Math.floor((t-START_T)/(7*86400000));
  const s=new Date(START_T+idx*7*86400000).toISOString().slice(0,10);
  const eT=Math.min(START_T+idx*7*86400000+6*86400000, END_T);
  const e=new Date(eT).toISOString().slice(0,10);
  return `${s.slice(5)}~${e.slice(5)}`;
}
function creativeLabel(raw,media){
  const s=raw==null?"":String(raw).trim();
  if(s)return s;
  return media==="organic"?"(organic)":"(no creative)";
}
// Google Ads(googleadwords_int)는 매체 특성상 소재(af_ad/ad) 단위 데이터를 공유하지 않아 항상
// 비어있다(사용자 확인) — 대신 ad_group(af_adset/adset)을 소재명으로 대체 사용한다.
function pickCreativeStd(r,media){ // installs/inapps/ad_revenue_v2/cohort_unified: af_ad/af_adset
  if(media==="googleadwords_int" && !String(r.af_ad??"").trim())return r.af_adset;
  return r.af_ad;
}
function pickCreativeCost(r,media){ // cost_etl_geo: ad/adset
  if(media==="googleadwords_int" && !String(r.ad??"").trim())return r.adset;
  return r.ad;
}
// D21/D30 예측(사용자 요청)용 — OS별, 설치일별, "설치 후 정확히 N일째"(dd) 매출을 세분화해 누적한다.
// 국가·캠페인은 합산(pooled)해 예측 곡선의 재료로만 쓴다: 개별 국가는 표본이 작아 일자별 곡선이
// 너무 들쭉날쭉하므로, OS 단위로 풀링한 "코호트 나이(day)별 누적 ROAS 증가 형태"를 기준 곡선으로 잡고
// 각 국가의 마지막 실측치에 그 형태(모양)만 이어붙이는 방식으로 예측한다.
const DAY_MAX=30;
const CURVE={};
function curveGet(o,d){const k=`${o}|||${d}`;if(!CURVE[k])CURVE[k]={os:o,date:d,cost:0,dayRev:new Array(DAY_MAX+1).fill(0)};return CURVE[k];}
// 일자별(캘린더 날짜, 코호트 아님) DAU/Active REV 누적 — 코호트 accumulator(R)와 동일한 5-tuple 키이나 date는 설치일이 아닌 이벤트 발생일(캘린더일).
const DA={};
function daKey(m,c,o,camp,d){return `${m}|||${c}|||${o}|||${camp}|||${d}`;}
function getDA(m,c,o,camp,d){const k=daKey(m,c,o,camp,d);if(!DA[k])DA[k]={media:m,country:c,os:o,campaign:camp,date:d,dau_users:0,active_rev:0};return DA[k];}
// 캠페인명이 없는 행(오가닉/미기재)에 대한 표시용 라벨
// + m1→ua 정규화: 캠페인명 4번째 토큰(underscore-index 3)이 운영 중 m1→ua로 리네이밍됨.
//   같은 실제 캠페인이 두 이름으로 쪼개지지 않도록 index-3의 "m1"을 "ua"로 통합한다.
//   (index 3에는 m1/ua 두 값만 존재. campCountry는 index 2만 읽어 영향 없음.)
function campLabel(raw,media){
  let s=raw==null?"":String(raw).trim();
  if(s){
    const parts=s.split("_");
    if(parts.length>3 && parts[3]==="m1"){ parts[3]="ua"; s=parts.join("_"); }
    return s;
  }
  return media==="organic"?"(organic)":"(no campaign)";
}
// SKAN 캠페인명에서 국가코드 추출: "2607_if_us_ua_ios_..." → US, "2607_if_ww(1tier)_..." → WW
function campCountry(name){
  const parts=String(name||"").split("_");
  const i=parts.indexOf("if");
  const tok=(i>=0?parts[i+1]:parts[2])||"";
  const m=tok.match(/^[a-z]+/i);
  return m?m[0].toUpperCase():"??";
}
// 일반(non-SKAN) 귀속용(사용자 요청): 캠페인명에 kr/us/jp 등 명확한 국가코드가 있으면 그 코드를 우선 사용한다.
// AppsFlyer raw country_code/geo가 실제 타겟 국가와 어긋나는 오귀속(예: us 캠페인인데 country_code=DE로 잡혀
// 실제로 광고를 집행하지 않은 DE로 잘못 귀속되는 문제)를 캠페인명이 명확할 때는 캠페인명으로 바로잡기 위함.
// "ww"처럼 국가를 특정할 수 없는 캠페인(및 organic/미기재)은 null을 반환해 호출측이 raw country_code/geo로 폴백한다.
function campCountryStrict(name){
  const c=campCountry(name);
  return (c!=="WW"&&c!=="??")?c:null;
}

// ══ 1. COST (app_id→OS, geo, campaign, date) — cost_etl_geo, 각 date 최신 dt=·최대 v= ══
// (cost_etl_summary는 campaign 컬럼이 없어 cost_etl_geo로 전환. 동일 계정 전체 합계로 검증: 두 테이블 총액 일치 확인됨)
//
// 주의: 캠페인명은 광고 매체 쪽 리네이밍(예: "..._m1_..." → "..._ua_...")으로 dt 스냅샷 사이에서
// 값이 바뀔 수 있다. 캠페인을 키에 포함해 다중 dt를 병합하면 옛 이름 항목이 "유령 중복"으로 남아
// 총액이 부풀려진다(검증됨). ← m1→ua 정규화(campLabel)로 이 리네이밍 케이스는 이미 통합됨.
// → (media,geo,os,date) 코어스 키의 신뢰 합계는 "코어스 키별 최신 dt 우승"으로 병합하고,
//   캠페인 분해는 각 코어스 키의 신뢰값을 제공한 "바로 그 우승 dt 스냅샷" 하나에서만 가져온다.
//   같은 스냅샷 내부는 정합적이라 fine 합 = 코어스 신뢰값과 정확히 일치 → 비례배분·fallback 불필요.
//   (이전의 "단일 최신 스냅샷 1개 + 비례배분" 방식은 그 스냅샷이 대부분의 코어스 셀을 담지 못해
//    비용의 ~47%가 "(no campaign detail)" fallback으로 빠지는 문제가 있었음 — 제거됨.)
process.stderr.write("[1] cost\n");
{
  const base=`${BASE}t=cost_etl_geo/`;
  const dts=(await listPrefixes(base)).map(p=>p.replace(base,"").replace(/\/$/,"").replace("dt=","")).sort();
  // cost뿐 아니라 impressions/clicks도 같은 우승-스냅샷 로직으로 귀속한다(cpm/ctr/cpc/cvr용).
  const byDtCoarse={};   // dt -> { "media|||geo|||os|||date": cost }  (winDt 판정용)
  const byDtFine={};     // dt -> { "media|||geo|||os|||campaign|||date": {cost,imp,clk} }
  for(const dt of dts){
    const vs=(await listPrefixes(`${base}dt=${dt}/`)).map(p=>({v:parseInt(p.match(/v=(\d+)/)?.[1]??"-1"),prefix:p})).filter(x=>x.v>=0).sort((a,b)=>b.v-a.v);
    if(!vs.length)continue;
    const coarse={}, fine={};
    for(const f of await listParquet(vs[0].prefix)){
      const rows=await readParquet(f,["app_id","media_source","date","geo","campaign","cost","impressions","clicks","ad","adset"]);
      for(const r of rows){
        const os=OS_OF[r.app_id]; if(!os)continue;
        const kd=r.date?String(r.date).slice(0,10):null; if(!kd||!inRange(kd))continue;
        const media=r.media_source||"organic";
        const camp=campLabel(r.campaign,media);
        const cre=creativeLabel(pickCreativeCost(r,media),media);
        const country=campCountryStrict(r.campaign)||(r.geo||"??");
        const cost=num(r.cost), imp=num(r.impressions), clk=num(r.clicks);
        const kc=`${media}|||${country}|||${os}|||${kd}`;
        const kf=`${media}|||${country}|||${os}|||${camp}|||${cre}|||${kd}`;
        coarse[kc]=(coarse[kc]||0)+cost;
        const fe=(fine[kf]=fine[kf]||{cost:0,imp:0,clk:0}); fe.cost+=cost; fe.imp+=imp; fe.clk+=clk;
      }
    }
    byDtCoarse[dt]=coarse; byDtFine[dt]=fine;
  }
  // 신뢰 합계: (media,geo,os,date) 코어스 키로 "최신 dt가 이긴다" 병합 (cost_etl_summary와 동일 로직/검증됨).
  // winDt[kc] = 각 코어스 키의 신뢰값을 제공한 우승 dt 스냅샷.
  const trustedCoarse={}, winDt={};
  for(const dt of dts.slice().sort())for(const [k,v] of Object.entries(byDtCoarse[dt]||{})){trustedCoarse[k]=v;winDt[k]=dt;}
  // 캠페인·소재 분해: 각 fine 행을, 그 코어스 부모의 우승 dt 스냅샷에서만 채택.
  // → 같은 스냅샷 내부이므로 fine 합 = 코어스 신뢰값과 정확히 일치(비례배분/fallback 불필요, 총액 불변).
  for(const dt of dts){
    for(const [kf,fe] of Object.entries(byDtFine[dt]||{})){
      const p=kf.split("|||");                       // m,geo,os,camp,cre,date
      const kc=`${p[0]}|||${p[1]}|||${p[2]}|||${p[5]}`;
      if(winDt[kc]!==dt)continue;                     // 우승 dt만
      const e=get(p[0],p[1],p[2],p[3],p[5]); e.cost+=fe.cost; e.imp+=fe.imp; e.clk+=fe.clk;
      const ec=getC(p[0],p[1],p[2],p[3],p[4],weekLabel(p[5])); ec.cost+=fe.cost; ec.imp+=fe.imp; ec.clk+=fe.clk;
    }
  }
}

// ══ 2. installs (path app_id→OS, country_code) ══
process.stderr.write("[2] installs\n");
for(const dt of await dtList("installs","dt=2026-07-06")){
  for(const hp of await listPrefixes(`${BASE}t=installs/${dt}/`)){
    for(const appId of APP_IDS){const os=OS_OF[appId];
      for(const f of await listParquet(`${hp}app_id=${appId}/`)){
        const rows=await readParquet(f,["install_time","media_source","country_code","campaign","af_ad","af_adset"]);
        for(const r of rows){
          const kd=toKSTDate(r.install_time);if(!kd||!inRange(kd))continue;
          const media=r.media_source||"organic";
          const country=campCountryStrict(r.campaign)||(r.country_code||"??");
          const camp=campLabel(r.campaign,media);
          get(media,country,os,camp,kd).ir++;
          getC(media,country,os,camp,creativeLabel(pickCreativeStd(r,media),media),weekLabel(kd)).ir++;
        }
      }
    }
  }
  process.stderr.write(`  installs ${dt}\n`);
}

// ══ 3. skad installs (iOS only, flag≠true) ══
process.stderr.write("[3] skad\n");
for(const dt of await dtList("skad_installs","dt=2026-07-06")){
  for(const hp of await listPrefixes(`${BASE}t=skad_installs/${dt}/`)){
    for(const appId of APP_IDS){const os=OS_OF[appId];
      for(const f of await listParquet(`${hp}app_id=${appId}/`)){
        const rows=await readParquet(f,["install_date","media_source","af_attribution_flag","ad_network_campaign_name","ad_network_ad_name"]);
        for(const r of rows){
          if(String(r.af_attribution_flag).toLowerCase()==="true")continue;
          const kd=r.install_date?String(r.install_date).slice(0,10):null;if(!kd||!inRange(kd))continue;
          const media=r.media_source||"unknown";
          const camp=campLabel(r.ad_network_campaign_name,media);
          const country=campCountry(r.ad_network_campaign_name);
          get(media,country,os,camp,kd).is++;
          getC(media,country,os,camp,creativeLabel(r.ad_network_ad_name,media),weekLabel(kd)).is++;
        }
      }
    }
  }
  process.stderr.write(`  skad ${dt}\n`);
}

// ══ 4. revenue (cohort D1/D3) ══
process.stderr.write("[4] revenue\n");
function apply(r,kind,os){
  const rev=parseFloat(r.event_revenue_usd)||0; if(rev<=0)return;
  const ind=toKSTDate(r.install_time), evd=toKSTDate(r.event_time);
  if(!ind||!inRange(ind)||!evd)return;
  // event_time이 install_time보다 앞서는(days<0) 매출은 AppsFlyer와 동일하게 Day 0으로 귀속(clamp)
  const dd=Math.max(0,daysBetween(ind,evd));
  const media=r.media_source||"organic";
  const country=campCountryStrict(r.campaign)||(r.country_code||"??");
  const camp=campLabel(r.campaign,media);
  const cre=creativeLabel(pickCreativeStd(r,media),media);
  const e=get(media,country,os,camp,ind);
  const ec=getC(media,country,os,camp,cre,weekLabel(ind));
  curveGet(os,ind).dayRev[Math.min(dd,DAY_MAX)]+=rev;
  // Active REV(캘린더 날짜 기준, 코호트 아님): 이 이벤트가 실제로 발생한 날짜(evd)에 귀속.
  if(inRange(evd))getDA(media,country,os,camp,evd).active_rev+=rev;
  if(dd<=1){ if(kind==="iap"){e.d1_iap+=rev;ec.d1_iap+=rev;} else {e.d1_iaa+=rev;ec.d1_iaa+=rev;} }
  if(dd<=3){ if(kind==="iap"){e.d3_iap+=rev;ec.d3_iap+=rev;} else {e.d3_iaa+=rev;ec.d3_iaa+=rev;} }
  if(dd<=7){ if(kind==="iap"){e.d7_iap+=rev;ec.d7_iap+=rev;} else {e.d7_iaa+=rev;ec.d7_iaa+=rev;} }
  if(dd<=14){ if(kind==="iap"){e.d14_iap+=rev;ec.d14_iap+=rev;} else {e.d14_iaa+=rev;ec.d14_iaa+=rev;} }
  if(dd<=21){ if(kind==="iap"){e.d21_iap+=rev;ec.d21_iap+=rev;} else {e.d21_iaa+=rev;ec.d21_iaa+=rev;} }
  if(dd<=30){ if(kind==="iap"){e.d30_iap+=rev;ec.d30_iap+=rev;} else {e.d30_iaa+=rev;ec.d30_iaa+=rev;} }
  // 유료 결제자(distinct 사용자 수) — IAP(af_purchase)만, appsflyer_id로 중복 제거. D1/D3 누적.
  if(kind==="iap"){
    const uid=r.appsflyer_id||r.customer_user_id;
    if(uid){
      if(dd<=1){e.pur_d1.add(uid);ec.pur_d1.add(uid);}
      if(dd<=3){e.pur_d3.add(uid);ec.pur_d3.add(uid);}
    }
  }
}
// IAP
for(const dt of await dtList("inapps","dt=2026-07-06")){
  for(const hp of await listPrefixes(`${BASE}t=inapps/${dt}/`)){
    for(const appId of APP_IDS){const os=OS_OF[appId];
      for(const f of await listParquet(`${hp}app_id=${appId}/`)){
        const rows=await readParquet(f,["event_time","install_time","event_name","event_revenue_usd","media_source","country_code","campaign","appsflyer_id","customer_user_id","af_ad","af_adset"]);
        for(const r of rows)if(r.event_name==="af_purchase")apply(r,"iap",os);
      }
    }
  }
  process.stderr.write(`  inapps ${dt}\n`);
}
// IAA
for(const tbl of ["attributed_ad_revenue_v2","organic_ad_revenue_v2","retargeting_ad_revenue_v2"]){
  for(const dt of await dtList(tbl,"dt=2026-07-06")){
    const vs=(await listPrefixes(`${BASE}t=${tbl}/${dt}/`)).map(p=>({v:parseInt(p.match(/version=(\d+)/)?.[1]??"-1"),prefix:p})).filter(x=>x.v>=0).sort((a,b)=>b.v-a.v);
    if(!vs.length)continue;
    for(const appId of APP_IDS){const os=OS_OF[appId];
      for(const f of await listParquet(`${vs[0].prefix}app_id=${appId}/`)){
        const rows=await readParquet(f,["event_time","install_time","event_revenue_usd","media_source","country_code","campaign","af_ad","af_adset"]);
        for(const r of rows)apply(r,"iaa",os);
      }
    }
    process.stderr.write(`  ${tbl} ${dt}\n`);
  }
}

// ══ 5. SKAN 매출 (skad_inapps, coarse 추정치, flag≠true, event_time 없음 → 설치일 코호트에만 귀속) ══
process.stderr.write("[5] skad_inapps (SKAN revenue)\n");
for(const dt of await dtList("skad_inapps","dt=2026-07-06")){
  for(const hp of await listPrefixes(`${BASE}t=skad_inapps/${dt}/`)){
    for(const appId of APP_IDS){const os=OS_OF[appId];
      for(const f of await listParquet(`${hp}app_id=${appId}/`)){
        const rows=await readParquet(f,["install_date","media_source","af_attribution_flag","ad_network_campaign_name","ad_network_ad_name","skad_revenue"]);
        for(const r of rows){
          if(String(r.af_attribution_flag).toLowerCase()==="true")continue; // 일반 어트리뷰션과 중복 제외
          const kd=r.install_date?String(r.install_date).slice(0,10):null;
          if(!kd||!inRange(kd))continue;
          const rev=parseFloat(r.skad_revenue)||0; if(rev<=0)continue;
          const media=r.media_source||"unknown";
          const camp=campLabel(r.ad_network_campaign_name,media);
          const country=campCountry(r.ad_network_campaign_name);
          get(media,country,os,camp,kd).skan_rev+=rev;
          getC(media,country,os,camp,creativeLabel(r.ad_network_ad_name,media),weekLabel(kd)).skan_rev+=rev;
        }
      }
    }
  }
  process.stderr.write(`  skad_inapps ${dt}\n`);
}

// ══ 6. cohort_unified (af_session 이벤트 → RR% 분자 + DAU) ══
// dt=날짜 파티션은 누적 스냅샷이 아니라 "그 날짜(event_date)에 발생한 이벤트"만 담은 증분 로그 —
// 다른 원시 이벤트 테이블(inapps 등)과 동일하게 전체 dt 범위를 스캔해야 한다.
// 구조는 t=cohort_unified/dt=.../app_id=.../*.parquet 로, installs 등과 달리 시간대(h=) 폴더가 없다.
process.stderr.write("[6] cohort_unified (af_session)\n");
for(const dt of await dtList("cohort_unified","dt=2026-07-06")){
  for(const appId of APP_IDS){const os=OS_OF[appId];
    for(const f of await listParquet(`${BASE}t=cohort_unified/${dt}/app_id=${appId}/`)){
      const rows=await readParquet(f,["conversion_date","event_date","event_name","days_post_attribution","media_source","geo","campaign","unique_users","af_ad","af_adset"]);
      for(const r of rows){
        if(r.event_name!=="af_session")continue;
        const cd=r.conversion_date?String(r.conversion_date).slice(0,10):null;
        const ed=r.event_date?String(r.event_date).slice(0,10):null;
        const dpa=r.days_post_attribution==null?null:num(r.days_post_attribution);
        const media=r.media_source||"organic";
        const country=campCountryStrict(r.campaign)||(r.geo||"??");
        const camp=campLabel(r.campaign,media);
        const cre=creativeLabel(pickCreativeStd(r,media),media);
        const uu=num(r.unique_users);
        if(cd&&inRange(cd)&&dpa!=null){
          const e=get(media,country,os,camp,cd);
          const ec=getC(media,country,os,camp,cre,weekLabel(cd));
          if(dpa===1){e.rr1_users+=uu;ec.rr1_users+=uu;}
          if(dpa===3){e.rr3_users+=uu;ec.rr3_users+=uu;}
          if(dpa===7){e.rr7_users+=uu;ec.rr7_users+=uu;}
          if(dpa===30){e.rr30_users+=uu;ec.rr30_users+=uu;}
        }
        // DAU: conversion_date/days_post_attribution 무관하게, 실제 세션이 발생한 캘린더 날짜(ed) 기준으로 합산.
        // 동일 유저는 하루에 하나의 media/country/campaign 조합에만 속하므로 중복 카운트 아님.
        if(ed&&inRange(ed))getDA(media,country,os,camp,ed).dau_users+=uu;
      }
    }
  }
  process.stderr.write(`  cohort_unified ${dt}\n`);
}

// ══ 7. sessions(launch) — "전체 합계" DAU 전용: 국가별 기간 내 순수(dedup) 유저 수 ══
// cohort_unified의 unique_users는 (event_date, media, country, campaign 등) 조합별로 이미 집계된
// 값이라 여러 날짜에 걸쳐 그대로 더하면 같은 유저가 여러 날 재방문 시 중복 카운트된다(세그먼트 트리의
// 개별 노드 값은 그 방식을 그대로 쓴다 — 사용자 요청에 따라 세그먼트별 표시는 유지). 하지만 "전체 합계"
// 행은 코호트 하위 데이터를 단순 합산한 값이 아니라 "해당 기간 실제 총 유저 수"여야 하므로, 이 섹션에서
// user-id 단위 원시 세션(launch) 이벤트를 읽어 국가별로 dedup Set을 구성한다(용량 절감을 위해 실제
// appsflyer_id 문자열 대신 짧은 정수 ID로 치환해 저장). 국가는 서로 겹치지 않으므로(같은 유저가 여러
// 국가에 동시에 속하지 않음) 여러 국가를 선택했을 때는 각 국가의 dedup 수를 그대로 더해도 안전하다 —
// 다만 같은 국가 내에서 여러 날짜를 합칠 때는 반드시 Set 합집합(union)으로 처리해야 한다(클라이언트에서 수행).
process.stderr.write("[7] sessions (DAU 전체 합계 dedup, 증분 캐시)\n");

// ── 증분 캐시: sessions 테이블은 raw 세션(launch) 이벤트라 가장 무거운 테이블 — 매일 START부터
// 전체를 재스캔하면 날짜 범위가 늘어날수록 실행 시간이 계속 길어져 타임아웃을 유발한다(실제 발생).
// dt(S3 파티션)는 UTC 기준이라 KST로 변환하면 하나의 dt가 두 KST 날짜에 걸쳐 기여할 수 있으므로,
// 캐시는 항상 (국가, KST 날짜) 단위로 유지하고 dt는 "이미 전부 스캔해 캐시에 반영했는지"만 추적한다.
// 최근 ROLL_N개의 dt는 late-arriving 이벤트에 대비해 매번 무조건 재스캔한다 — 실측 지연 데이터가
// 없어 근거 기반 값은 아니며, 보수적 기본값으로 필요시 조정 가능.
const DAU_CACHE_PATH=dataPath("dau-session-cache.json");
const ROLL_N=3;
function loadDauCache(){
  const empty={version:1,start:START,processedDt:[],frozenUsers:{}};
  let raw; try{raw=readFileSync(DAU_CACHE_PATH,"utf8");}catch{return empty;}
  let parsed; try{parsed=JSON.parse(raw);}catch(e){process.stderr.write(`  [7] cache 손상(JSON parse 실패), 전체 재스캔 폴백: ${e.message}\n`);return empty;}
  if(!parsed||parsed.version!==1||!Array.isArray(parsed.processedDt)||typeof parsed.frozenUsers!=="object"||parsed.frozenUsers===null){
    process.stderr.write("  [7] cache 스키마 불일치, 전체 재스캔 폴백\n"); return empty;
  }
  if(parsed.start!==START){
    process.stderr.write(`  [7] cache의 start(${parsed.start})≠현재 START(${START}), 전체 재스캔 폴백\n`); return empty;
  }
  return parsed;
}
function saveDauCache(cache){
  const tmp=DAU_CACHE_PATH+".tmp";
  writeFileSync(tmp,JSON.stringify(cache),"utf8");
  renameSync(tmp,DAU_CACHE_PATH); // 원자적 교체 — 동시 실행/중단 시 반쪽짜리 캐시 노출 방지
}
const dauCache=loadDauCache();
const processedSet=new Set(dauCache.processedDt);

const ALL_DT=await dtList("sessions",START); // 기존 호출 그대로(오름차순 정렬 보장)
const rollingDt=ALL_DT.slice(-ROLL_N);
const frozenCandidates=ALL_DT.slice(0,Math.max(0,ALL_DT.length-ROLL_N));
const newFrozenDts=frozenCandidates.filter(dt=>!processedSet.has(dt));

// country -> date(KST) -> Set<rawId> — 압축 정수 ID는 맨 마지막에만 부여(회차 간 재사용 불가하므로).
const RAW={};
function rawSet(country,date){ if(!RAW[country])RAW[country]={}; if(!RAW[country][date])RAW[country][date]=new Set(); return RAW[country][date]; }

async function scanSessionDt(dt,sink){
  for(const hp of await listPrefixes(`${BASE}t=sessions/${dt}/`)){
    for(const appId of APP_IDS){
      for(const f of await listParquet(`${hp}app_id=${appId}/`)){
        const rows=await readParquet(f,["event_time","appsflyer_id","customer_user_id","country_code"]);
        for(const r of rows){
          const ed=toKSTDate(r.event_time); if(!ed||!inRange(ed))continue;
          const rawId=r.appsflyer_id||r.customer_user_id; if(!rawId)continue;
          sink(r.country_code||"??",ed).add(rawId);
        }
      }
    }
  }
  process.stderr.write(`  sessions ${dt}\n`);
}

// 1) 캐시된 frozen 데이터 로드 (inRange 방어 필터 — START가 바뀌는 등 예외 상황에도 범위 밖 유입 차단)
for(const [country,byDate] of Object.entries(dauCache.frozenUsers||{})){
  for(const [date,ids] of Object.entries(byDate)){
    if(!inRange(date))continue;
    const s=rawSet(country,date); for(const id of ids)s.add(id);
  }
}

// 2) 새로 frozen 대상이 된 dt만 스캔(보통 하루에 최대 1개) — 전부 성공해야 캐시에 반영(부분 반영 없음)
const newlyFrozenRaw={};
function newlyFrozenSet(country,date){ if(!newlyFrozenRaw[country])newlyFrozenRaw[country]={}; if(!newlyFrozenRaw[country][date])newlyFrozenRaw[country][date]=new Set(); return newlyFrozenRaw[country][date]; }
for(const dt of newFrozenDts) await scanSessionDt(dt,newlyFrozenSet);

for(const [country,byDate] of Object.entries(newlyFrozenRaw)){
  for(const [date,ids] of Object.entries(byDate)){
    const s=rawSet(country,date); for(const id of ids)s.add(id);
    if(!dauCache.frozenUsers[country])dauCache.frozenUsers[country]={};
    const merged=new Set(dauCache.frozenUsers[country][date]||[]);
    for(const id of ids)merged.add(id);
    dauCache.frozenUsers[country][date]=[...merged].sort();
  }
}
if(newFrozenDts.length){
  dauCache.processedDt=[...processedSet,...newFrozenDts];
  dauCache.start=START; dauCache.version=1;
  saveDauCache(dauCache);
}

// 3) 롤링 구간(ROLL_N개)은 매번 새로 스캔하되 캐시에는 절대 반영하지 않음(in-memory 전용)
for(const dt of rollingDt) await scanSessionDt(dt,rawSet);

// 4) 압축 정수 ID 매핑은 병합이 끝난 RAW 전체에 대해 맨 마지막에만 수행(이후 dauUsers 빌드 블록은 무수정)
const userIntId=new Map(); let nextUid=0;
function uid(rawId){ if(!userIntId.has(rawId))userIntId.set(rawId,nextUid++); return userIntId.get(rawId); }
const DAU_SETS={}; // country -> date -> Set<intId>
function dauSet(country,date){ if(!DAU_SETS[country])DAU_SETS[country]={}; if(!DAU_SETS[country][date])DAU_SETS[country][date]=new Set(); return DAU_SETS[country][date]; }
for(const [country,byDate] of Object.entries(RAW)){
  for(const [date,ids] of Object.entries(byDate)){
    const s=dauSet(country,date);
    for(const rawId of ids) s.add(uid(rawId));
  }
}

// ══ BUILD ══
const out=[];
for(const e of Object.values(R)){
  const total=e.ir+e.is;
  const d1=e.d1_iap+e.d1_iaa, d3=e.d3_iap+e.d3_iaa, d7=e.d7_iap+e.d7_iaa;
  const d14=e.d14_iap+e.d14_iaa, d21=e.d21_iap+e.d21_iaa, d30=e.d30_iap+e.d30_iaa;
  out.push({
    media:e.media,country:e.country,os:e.os,campaign:e.campaign,date:e.date,
    cost:+e.cost.toFixed(2),
    install_total:total, install_reg:e.ir, install_skan:e.is,
    cpi: e.cost>0&&total>0?+(e.cost/total).toFixed(2):null,
    imp:e.imp, clk:e.clk,
    pur_d1_cnt:e.pur_d1.size, pur_d3_cnt:e.pur_d3.size,
    rev_d1:+d1.toFixed(2), rev_d3:+d3.toFixed(2), rev_d7:+d7.toFixed(2),
    rev_d14:+d14.toFixed(2), rev_d21:+d21.toFixed(2), rev_d30:+d30.toFixed(2),
    rev_d1_iap:+e.d1_iap.toFixed(2), rev_d1_iaa:+e.d1_iaa.toFixed(2),
    rev_d3_iap:+e.d3_iap.toFixed(2), rev_d3_iaa:+e.d3_iaa.toFixed(2),
    rev_d7_iap:+e.d7_iap.toFixed(2), rev_d7_iaa:+e.d7_iaa.toFixed(2),
    rev_d14_iap:+e.d14_iap.toFixed(2), rev_d14_iaa:+e.d14_iaa.toFixed(2),
    rev_d21_iap:+e.d21_iap.toFixed(2), rev_d21_iaa:+e.d21_iaa.toFixed(2),
    rev_d30_iap:+e.d30_iap.toFixed(2), rev_d30_iaa:+e.d30_iaa.toFixed(2),
    skan_rev:+e.skan_rev.toFixed(2),
    rr_d1_users:e.rr1_users, rr_d3_users:e.rr3_users, rr_d7_users:e.rr7_users, rr_d30_users:e.rr30_users,
    roas_d1: e.cost>0&&d1>0?+(d1/e.cost*100).toFixed(2):null,
    roas_d3: e.cost>0&&d3>0?+(d3/e.cost*100).toFixed(2):null,
    roas_d7: e.cost>0&&d7>0?+(d7/e.cost*100).toFixed(2):null,
    roas_d14: e.cost>0&&d14>0?+(d14/e.cost*100).toFixed(2):null,
    roas_d21: e.cost>0&&d21>0?+(d21/e.cost*100).toFixed(2):null,
    roas_d30: e.cost>0&&d30>0?+(d30/e.cost*100).toFixed(2):null,
  });
}
out.sort((a,b)=>a.date.localeCompare(b.date)||a.media.localeCompare(b.media)||a.os.localeCompare(b.os)||b.cost-a.cost);
// curveByOs: 국가/캠페인/매체 합산(pooled) cost — D21/D30 예측 곡선의 분모로 사용.
for(const r of out) curveGet(r.os,r.date).cost+=r.cost;
const curveByOs={};
for(const cv of Object.values(CURVE)){
  (curveByOs[cv.os]=curveByOs[cv.os]||[]).push({date:cv.date,cost:+cv.cost.toFixed(2),dayRev:cv.dayRev.map(v=>+v.toFixed(2))});
}
// dailyActive: 캘린더 날짜(코호트 아님) 기준 DAU/Active REV — Data Table의 "date"(설치일 코호트) 축과는 별개의 배열.
const dailyActive=[];
for(const d of Object.values(DA)){
  dailyActive.push({media:d.media,country:d.country,os:d.os,campaign:d.campaign,date:d.date,dau:d.dau_users,active_rev:+d.active_rev.toFixed(2)});
}
// dauUsers: "전체 합계" DAU 전용 dedup 유저 ID 목록(국가별·날짜별, 정수 ID). 세그먼트 트리 값(dailyActive)과
// 달리 media/campaign/os 분해가 없다 — 전체 합계 행은 세그먼트 순서와 무관한 단일 숫자이기 때문.
const dauUsers={};
for(const [country,byDate] of Object.entries(DAU_SETS)){
  dauUsers[country]={};
  for(const [date,set] of Object.entries(byDate)) dauUsers[country][date]=[...set];
}
// rowsCreative: 소재(creative) 뎁스 추가 + 주차별 버킷(캠페인 시작일 2026-07-07부터 7일 단위) — RC 기반.
const outCreative=[];
for(const e of Object.values(RC)){
  const total=e.ir+e.is;
  const d1=e.d1_iap+e.d1_iaa, d3=e.d3_iap+e.d3_iaa, d7=e.d7_iap+e.d7_iaa;
  const d14=e.d14_iap+e.d14_iaa, d21=e.d21_iap+e.d21_iaa, d30=e.d30_iap+e.d30_iaa;
  outCreative.push({
    media:e.media,country:e.country,os:e.os,campaign:e.campaign,creative:e.creative,week:e.week,
    cost:+e.cost.toFixed(2),
    install_total:total, install_reg:e.ir, install_skan:e.is,
    cpi: e.cost>0&&total>0?+(e.cost/total).toFixed(2):null,
    imp:e.imp, clk:e.clk,
    pur_d1_cnt:e.pur_d1.size, pur_d3_cnt:e.pur_d3.size,
    rev_d1:+d1.toFixed(2), rev_d3:+d3.toFixed(2), rev_d7:+d7.toFixed(2),
    rev_d14:+d14.toFixed(2), rev_d21:+d21.toFixed(2), rev_d30:+d30.toFixed(2),
    rev_d1_iap:+e.d1_iap.toFixed(2), rev_d1_iaa:+e.d1_iaa.toFixed(2),
    rev_d3_iap:+e.d3_iap.toFixed(2), rev_d3_iaa:+e.d3_iaa.toFixed(2),
    rev_d7_iap:+e.d7_iap.toFixed(2), rev_d7_iaa:+e.d7_iaa.toFixed(2),
    rev_d14_iap:+e.d14_iap.toFixed(2), rev_d14_iaa:+e.d14_iaa.toFixed(2),
    rev_d21_iap:+e.d21_iap.toFixed(2), rev_d21_iaa:+e.d21_iaa.toFixed(2),
    rev_d30_iap:+e.d30_iap.toFixed(2), rev_d30_iaa:+e.d30_iaa.toFixed(2),
    skan_rev:+e.skan_rev.toFixed(2),
    rr_d1_users:e.rr1_users, rr_d3_users:e.rr3_users, rr_d7_users:e.rr7_users, rr_d30_users:e.rr30_users,
    roas_d1: e.cost>0&&d1>0?+(d1/e.cost*100).toFixed(2):null,
    roas_d3: e.cost>0&&d3>0?+(d3/e.cost*100).toFixed(2):null,
    roas_d7: e.cost>0&&d7>0?+(d7/e.cost*100).toFixed(2):null,
    roas_d14: e.cost>0&&d14>0?+(d14/e.cost*100).toFixed(2):null,
    roas_d21: e.cost>0&&d21>0?+(d21/e.cost*100).toFixed(2):null,
    roas_d30: e.cost>0&&d30>0?+(d30/e.cost*100).toFixed(2):null,
  });
}
outCreative.sort((a,b)=>a.week.localeCompare(b.week)||a.media.localeCompare(b.media)||a.os.localeCompare(b.os)||b.cost-a.cost);

writeFileSync(dataPath("geo-cohort-os-result.json"), JSON.stringify({rows:out,curveByOs,dailyActive,dauUsers,rowsCreative:outCreative},null,2),"utf8");
process.stdout.write(`rows: ${out.length}\n`);
process.stdout.write(`rowsCreative: ${outCreative.length}\n`);
// OS 요약
const byOs={};for(const r of out){if(!byOs[r.os])byOs[r.os]={inst:0,cost:0,imp:0,clk:0,d1:0,d3:0,d7:0,pur1:0,pur3:0};const b=byOs[r.os];b.inst+=r.install_total;b.cost+=r.cost;b.imp+=r.imp;b.clk+=r.clk;b.d1+=r.rev_d1;b.d3+=r.rev_d3;b.d7+=r.rev_d7;b.pur1+=r.pur_d1_cnt;b.pur3+=r.pur_d3_cnt;}
for(const [o,v] of Object.entries(byOs))process.stdout.write(`  ${o}: inst=${v.inst} cost=$${v.cost.toFixed(0)} imp=${v.imp} clk=${v.clk} D1=$${v.d1.toFixed(0)} D3=$${v.d3.toFixed(0)} D7=$${v.d7.toFixed(0)} pur(D1/D3)=${v.pur1}/${v.pur3}\n`);
// IAP vs IAA 총액 (D1/D3/D7)
let d1iap=0,d1iaa=0,d3iap=0,d3iaa=0,d7iap=0,d7iaa=0;
for(const r of out){d1iap+=r.rev_d1_iap;d1iaa+=r.rev_d1_iaa;d3iap+=r.rev_d3_iap;d3iaa+=r.rev_d3_iaa;d7iap+=r.rev_d7_iap;d7iaa+=r.rev_d7_iaa;}
process.stdout.write(`\nD1 매출 총액: IAP=$${d1iap.toFixed(2)} + IAA=$${d1iaa.toFixed(2)} = $${(d1iap+d1iaa).toFixed(2)}\n`);
process.stdout.write(`D3 매출 총액: IAP=$${d3iap.toFixed(2)} + IAA=$${d3iaa.toFixed(2)} = $${(d3iap+d3iaa).toFixed(2)}\n`);
process.stdout.write(`D7 매출 총액: IAP=$${d7iap.toFixed(2)} + IAA=$${d7iaa.toFixed(2)} = $${(d7iap+d7iaa).toFixed(2)}\n`);
let d14t=0,d21t=0,d30t=0;for(const r of out){d14t+=r.rev_d14;d21t+=r.rev_d21;d30t+=r.rev_d30;}
process.stdout.write(`D14 매출 총액: $${d14t.toFixed(2)}\nD21 매출 총액: $${d21t.toFixed(2)}\nD30 매출 총액: $${d30t.toFixed(2)}\n`);
// D14/21/30 IAP vs IAA 총액
let d14iap=0,d14iaa=0,d21iap=0,d21iaa=0,d30iap=0,d30iaa=0;
for(const r of out){d14iap+=r.rev_d14_iap;d14iaa+=r.rev_d14_iaa;d21iap+=r.rev_d21_iap;d21iaa+=r.rev_d21_iaa;d30iap+=r.rev_d30_iap;d30iaa+=r.rev_d30_iaa;}
process.stdout.write(`  (IAP/IAA) D14=$${d14iap.toFixed(2)}/$${d14iaa.toFixed(2)} D21=$${d21iap.toFixed(2)}/$${d21iaa.toFixed(2)} D30=$${d30iap.toFixed(2)}/$${d30iaa.toFixed(2)}\n`);
// RR% 분자 합계 (install_total 대비 대략적 상한 점검용)
let instT=0,rr1=0,rr3=0,rr7=0,rr30=0;
for(const r of out){instT+=r.install_total;rr1+=r.rr_d1_users;rr3+=r.rr_d3_users;rr7+=r.rr_d7_users;rr30+=r.rr_d30_users;}
process.stdout.write(`RR 분자 합계(install_total=${instT}): D1=${rr1} D3=${rr3} D7=${rr7} D30=${rr30}\n`);
// DAU/Active REV 합계
let dauT=0,activeRevT=0;for(const d of dailyActive){dauT+=d.dau;activeRevT+=d.active_rev;}
process.stdout.write(`dailyActive rows: ${dailyActive.length}, DAU 합계(일자 단순합산)=${dauT}, Active REV 합계=$${activeRevT.toFixed(2)}\n`);
// 전체 합계 DAU(dedup) — 국가별 union 크기의 합 (국가는 서로 겹치지 않으므로 안전)
let periodDauT=0;
for(const byDate of Object.values(dauUsers)){
  const union=new Set();
  for(const ids of Object.values(byDate))for(const id of ids)union.add(id);
  periodDauT+=union.size;
}
process.stdout.write(`전체 합계 DAU(기간 dedup, 전체 국가)=${periodDauT} (단순합산 대비 ${((1-periodDauT/dauT)*100).toFixed(1)}% 낮음)\n`);
