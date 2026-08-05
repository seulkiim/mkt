import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";
import { writeFileSync } from "fs";
import { dataPath } from "./paths.mjs";

const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];

// 7/7~7/13 KST
const TARGET_KST = ["2026-07-07","2026-07-08","2026-07-09","2026-07-10","2026-07-11","2026-07-12","2026-07-13"];
const KST_START  = new Date("2026-07-07T00:00:00+09:00");
const KST_END    = new Date("2026-07-13T23:59:59+09:00");
// UTC dt range for raw event tables
const TARGET_DTS = ["dt=2026-07-06","dt=2026-07-07","dt=2026-07-08","dt=2026-07-09","dt=2026-07-10","dt=2026-07-11","dt=2026-07-12","dt=2026-07-13"];

function toKSTDate(ts) {
  if (!ts) return null;
  const d = typeof ts === "number" ? new Date(ts) : new Date(String(ts).includes("T") || String(ts).includes(" ") ? ts : ts+"T00:00:00Z");
  const kst = new Date(d.getTime() + 9*3600000);
  return kst.toISOString().slice(0,10);
}
function inRange(kd) { return TARGET_KST.includes(kd); }

// key: "media|date"
const data = {}; // media|date -> { installs_reg, installs_skad, installs_total, clicks, impressions, cost, rev_iap, rev_iaa, rev_skad }
function ensure(media, date) {
  const k = `${media}|||${date}`;
  if (!data[k]) data[k] = { media, date, installs_reg:0, installs_skad:0, clicks:0, impressions:0, cost:0, rev_iap:0, rev_iaa:0, rev_skad:0 };
  return data[k];
}

// ── util: list all parquet files under prefix ──
async function listParquet(prefix) {
  const files = [];
  let token;
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000, ContinuationToken: token }));
    for (const o of (r.Contents||[])) if (o.Size>0&&o.Key.endsWith(".parquet")) files.push(o.Key);
    token = r.NextContinuationToken;
  } while (token);
  return files;
}

async function readParquet(key, wantCols) {
  const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks=[]; for await (const c of resp.Body) chunks.push(c);
  const buf=Buffer.concat(chunks);
  const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
  const meta=parquetMetadata(ab);
  const allCols=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);
  const idxMap = wantCols.map(c => allCols.indexOf(c));
  const rows=[];
  await parquetRead({ file: ab, onComplete: rawRows => {
    for (const row of rawRows) {
      const obj={};
      wantCols.forEach((c,i)=>{ obj[c]=idxMap[i]>=0?row[idxMap[i]]:null; });
      rows.push(obj);
    }
  }});
  return rows;
}

async function scanDts(tbl, dts, appFilter, wantCols) {
  const prefix = `${BASE}t=${tbl}/`;
  const allRows = [];
  for (const dt of dts) {
    const s1 = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}${dt}/`, Delimiter:"/", MaxKeys:50 }));
    for (const p1 of (s1.CommonPrefixes||[])) {
      if (appFilter) {
        // app_id 폴더가 많을 수 있으므로 직접 경로 지정 (MaxKeys 잘림 방지)
        for (const appId of APP_IDS) {
          const appPrefix = `${p1.Prefix}app_id=${appId}/`;
          const files = await listParquet(appPrefix);
          for (const f of files) {
            try { allRows.push(...(await readParquet(f, wantCols))); }
            catch(e) { process.stderr.write(`  err ${f}: ${e.message.slice(0,50)}\n`); }
          }
        }
      } else {
        const s2 = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: p1.Prefix, Delimiter:"/", MaxKeys:500 }));
        for (const p2 of (s2.CommonPrefixes||[])) {
          const files = await listParquet(p2.Prefix);
          for (const f of files) {
            try { allRows.push(...(await readParquet(f, wantCols))); }
            catch(e) { process.stderr.write(`  err ${f}: ${e.message.slice(0,50)}\n`); }
          }
        }
      }
    }
    process.stderr.write(`  ${tbl}/${dt} done\n`);
  }
  return allRows;
}

// ad_revenue_v2 테이블 전용: 각 dt= 안에 version= 폴더가 여러 개(당일 누적 스냅샷)
// → 각 dt=의 최신(최대) version= 폴더 하나만 읽어야 중복 합산 방지
async function scanDtsMaxVersion(tbl, dts, wantCols) {
  const prefix = `${BASE}t=${tbl}/`;
  const allRows = [];
  for (const dt of dts) {
    const s1 = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}${dt}/`, Delimiter:"/", MaxKeys:200 }));
    // version= 폴더 중 최대값만
    const vFolders = (s1.CommonPrefixes||[])
      .map(p => ({ v: parseInt(p.Prefix.match(/version=(\d+)/)?.[1] ?? "-1"), prefix: p.Prefix }))
      .filter(x => x.v >= 0)
      .sort((a,b) => b.v - a.v);
    const maxV = vFolders[0];
    if (!maxV) { process.stderr.write(`  ${tbl}/${dt}: version= 폴더 없음, skip\n`); continue; }
    for (const appId of APP_IDS) {
      const files = await listParquet(`${maxV.prefix}app_id=${appId}/`);
      for (const f of files) {
        try { allRows.push(...(await readParquet(f, wantCols))); }
        catch(e) { process.stderr.write(`  err ${f}: ${e.message.slice(0,50)}\n`); }
      }
    }
    process.stderr.write(`  ${tbl}/${dt} done (version=${maxV.v})\n`);
  }
  return allRows;
}

// ══════════════════════════════════════════════
// 1. cost_etl_summary  (date, media_source, cost, impressions, clicks, installs)
// ══════════════════════════════════════════════
process.stderr.write("\n[1/5] cost_etl_summary\n");
// cost_etl_summary 특성:
//  (a) 각 dt= 파티션 안에 여러 v= 버전 폴더(재작성)가 있음 → 최대 v= 하나만 사용
//  (b) 누적 스냅샷: 각 dt=가 과거 날짜 전체를 포함. 당일/익일 값은 미완성 → 값이 며칠에 걸쳐 확정됨
//  (c) geo(국가)별로 행이 분할 → 합산 필요
//  규칙: 각 (media, date)는 그 date를 포함하는 "가장 최신 dt="의 "최대 v="에서만 집계
const costPrefix = `${BASE}t=cost_etl_summary/`;
const costDtR = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: costPrefix, Delimiter:"/", MaxKeys:50 }));
const costDtList = (costDtR.CommonPrefixes||[]).map(p=>p.Prefix.replace(costPrefix,"").replace(/\/$/,"").replace("dt=","")).sort();
process.stderr.write(`  available dt: ${costDtList.join(", ")}\n`);

// dt별로 (media|||date) → {cost,imp,clicks} 를 최대 v=에서만 집계
const costByDt = {}; // dt -> { key -> {cost,imp,clicks} }
for (const dt of costDtList) {
  // 이 dt= 안의 v= 폴더 중 최대 버전만 선택
  const vR = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${costPrefix}dt=${dt}/`, Delimiter:"/", MaxKeys:50 }));
  const vFolders = (vR.CommonPrefixes||[])
    .map(p => ({ v: parseInt(p.Prefix.match(/v=(\d+)/)?.[1] ?? "-1"), prefix: p.Prefix }))
    .filter(x => x.v >= 0)
    .sort((a,b) => b.v - a.v);
  const maxV = vFolders[0];
  if (!maxV) { process.stderr.write(`  cost_etl/dt=${dt}: v= 폴더 없음, skip\n`); continue; }

  const agg = {};
  const files = await listParquet(maxV.prefix);
  for (const f of files) {
    try {
      const rows = await readParquet(f, ["app_id","media_source","date","cost","impressions","clicks"]);
      for (const r of rows) {
        if (!APP_IDS.includes(r.app_id)) continue;
        const kd = r.date ? String(r.date).slice(0,10) : null;
        if (!kd || !inRange(kd)) continue;
        const media = r.media_source || "organic";
        const key = `${media}|||${kd}`;
        if (!agg[key]) agg[key] = { cost:0, imp:0, clicks:0 };
        agg[key].cost   += parseFloat(r.cost)||0;
        agg[key].imp    += parseFloat(r.impressions)||0;
        agg[key].clicks += parseFloat(r.clicks)||0;
      }
    } catch(err) { process.stderr.write(`  cost err: ${err.message.slice(0,60)}\n`); }
  }
  costByDt[dt] = agg;
  process.stderr.write(`  cost_etl/dt=${dt} (v=${maxV.v}) done: ${Object.keys(agg).length} keys\n`);
}

// 각 (media|date) 조합에 대해 가장 최신 dt=의 값을 최종값으로 채택
// (dt를 오름차순으로 순회하며 덮어쓰면 최신 dt가 남음)
const finalCost = {};
for (const dt of costDtList.slice().sort()) {
  for (const [key, v] of Object.entries(costByDt[dt] || {})) {
    finalCost[key] = { ...v, srcDt: dt };
  }
}
for (const [key, v] of Object.entries(finalCost)) {
  const sep = key.lastIndexOf("|||");
  const media = key.slice(0, sep);
  const date  = key.slice(sep + 3);
  const e = ensure(media, date);
  e.cost        += v.cost;
  e.impressions += v.imp;
  e.clicks      += v.clicks;
}
process.stderr.write(`  cost 최종 반영: ${Object.keys(finalCost).length} (media|date) 조합\n`);

// ══════════════════════════════════════════════
// 2. Regular installs
// ══════════════════════════════════════════════
process.stderr.write("\n[2/5] installs\n");
const instRows = await scanDts("installs", TARGET_DTS, true, ["install_time","media_source","appsflyer_id"]);
for (const r of instRows) {
  const kd = toKSTDate(r.install_time);
  if (!kd || !inRange(kd)) continue;
  const media = r.media_source || "organic";
  ensure(media, kd).installs_reg++;
}

// ══════════════════════════════════════════════
// 3. SKAD installs (af_attribution_flag != "true" → 중복 아닌 순수 SKAD)
// ══════════════════════════════════════════════
process.stderr.write("\n[3/5] skad_installs\n");
// SKAdNetwork 포스트백은 install_date 이후 며칠에 걸쳐 지연 도착 → install_date별 데이터가
// 여러 dt= 파티션에 분산됨(각 dt=는 서로 다른 postback, 중복 아님 → 합산 OK).
// 따라서 사용 가능한 모든 skad dt= 파티션을 읽어야 최신 날짜 누락 방지.
// app_id는 경로에만 있으므로 appFilter=true로 우리 앱만 정확히 필터.
const skadPrefix = `${BASE}t=skad_installs/`;
const skadDtR = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: skadPrefix, Delimiter:"/", MaxKeys:100 }));
const skadDts = (skadDtR.CommonPrefixes||[])
  .map(p => p.Prefix.replace(skadPrefix,"").replace(/\/$/,""))
  .filter(dt => dt >= "dt=2026-07-06")  // TARGET_KST 최소일(7/7 KST) 커버 위해 7/6부터
  .sort();
process.stderr.write(`  skad dt 파티션: ${skadDts.join(", ")}\n`);
const skadInstRows = await scanDts("skad_installs", skadDts, true,
  ["install_date","media_source","af_attribution_flag","skad_did_win","ad_network_campaign_name"]);
let skadExcluded = 0;
for (const r of skadInstRows) {
  if (String(r.af_attribution_flag).toLowerCase() === "true") { skadExcluded++; continue; } // 중복(일반 어트리뷰션과 겹침) 제외
  const kd = r.install_date ? String(r.install_date).slice(0,10) : null;
  if (!kd || !inRange(kd)) continue;
  const media = r.media_source || "unknown";
  ensure(media, kd).installs_skad++;
}
process.stderr.write(`  af_attribution_flag=true 제외: ${skadExcluded}건\n`);

// ══════════════════════════════════════════════
// 4. Regular inapps → IAP revenue (af_purchase)
// ══════════════════════════════════════════════
process.stderr.write("\n[4/5] inapps (af_purchase revenue)\n");
// For revenue, use install_time KST for cohort day assignment → but actually
// for daily media performance, we group by event_time KST date
const inappsRows = await scanDts("inapps", TARGET_DTS, true,
  ["event_time","event_name","event_revenue_usd","media_source"]);
for (const r of inappsRows) {
  if (r.event_name !== "af_purchase") continue;
  const rev = parseFloat(r.event_revenue_usd)||0;
  if (rev <= 0) continue;
  const kd = toKSTDate(r.event_time);
  if (!kd || !inRange(kd)) continue;
  const media = r.media_source || "organic";
  ensure(media, kd).rev_iap += rev;
}

// ══════════════════════════════════════════════
// 5. IAA revenue from ad_revenue tables
// ══════════════════════════════════════════════
process.stderr.write("\n[5/5] ad_revenue (IAA)\n");
for (const tbl of ["attributed_ad_revenue_v2","organic_ad_revenue_v2","retargeting_ad_revenue_v2"]) {
  const rows = await scanDtsMaxVersion(tbl, TARGET_DTS, ["event_time","event_revenue_usd","media_source"]);
  for (const r of rows) {
    const rev = parseFloat(r.event_revenue_usd)||0;
    if (rev <= 0) continue;
    const kd = toKSTDate(r.event_time);
    if (!kd || !inRange(kd)) continue;
    const media = r.media_source || "organic";
    ensure(media, kd).rev_iaa += rev;
  }
}

// ══════════════════════════════════════════════
// BUILD RESULT
// ══════════════════════════════════════════════
const result = [];
for (const [, e] of Object.entries(data)) {
  const installs = e.installs_reg + e.installs_skad;
  const revenue  = e.rev_iap + e.rev_iaa + e.rev_skad;
  const cost     = e.cost;
  result.push({
    date:        e.date,
    media:       e.media,
    installs_reg:  e.installs_reg,
    installs_skad: e.installs_skad,
    installs:      installs,
    impressions:   Math.round(e.impressions),
    clicks:        Math.round(e.clicks),
    cost:          +cost.toFixed(4),
    rev_iap:       +e.rev_iap.toFixed(4),
    rev_iaa:       +e.rev_iaa.toFixed(4),
    revenue:       +revenue.toFixed(4),
    // KPIs
    cpi:  cost>0 && installs>0 ? +(cost/installs).toFixed(2) : null,
    cpm:  cost>0 && e.impressions>0 ? +(cost/e.impressions*1000).toFixed(2) : null,
    ctr:  e.impressions>0 && e.clicks>0 ? +(e.clicks/e.impressions*100).toFixed(3) : null,
    cpc:  cost>0 && e.clicks>0 ? +(cost/e.clicks).toFixed(2) : null,
    cvr:  e.clicks>0 && installs>0 ? +(installs/e.clicks*100).toFixed(2) : null,
    ipm:  e.impressions>0 && installs>0 ? +(installs/e.impressions*1000).toFixed(3) : null,
    roas: cost>0 && revenue>0 ? +(revenue/cost*100).toFixed(2) : null,
  });
}

result.sort((a,b)=> a.date.localeCompare(b.date) || a.media.localeCompare(b.media));

writeFileSync(dataPath("skad-perf-result.json"), JSON.stringify(result, null, 2), "utf8");
process.stderr.write("\nDone! → skad-perf-result.json\n");

// quick print
process.stdout.write("\n=== 결과 요약 ===\n");
result.forEach(r => {
  process.stdout.write(`${r.date} | ${r.media} | inst=${r.installs}(reg:${r.installs_reg}+skad:${r.installs_skad}) impr=${r.impressions} clicks=${r.clicks} cost=$${r.cost} rev=$${r.revenue} CPI=${r.cpi} CPM=${r.cpm} CTR=${r.ctr}% CVR=${r.cvr}% IPM=${r.ipm} ROAS=${r.roas}%\n`);
});
