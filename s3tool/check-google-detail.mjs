import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];

const KST_START = new Date("2026-07-07T00:00:00+09:00");
const KST_END   = new Date("2026-07-07T23:59:59+09:00");
function isKST77(ts) {
  if (!ts) return false;
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  return d >= KST_START && d <= KST_END;
}
function isGoogle(m) { return m && m.toLowerCase().includes("google"); }

async function readFiles(tbl, dts, wantCols, timeCol, filterFn) {
  const rows = [];
  const prefix = `${BASE}t=${tbl}/`;
  for (const dt of dts) {
    const hResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}${dt}/`, Delimiter: "/", MaxKeys: 50 }));
    for (const hPfx of (hResp.CommonPrefixes||[])) {
      const appResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: hPfx.Prefix, Delimiter: "/", MaxKeys: 10 }));
      for (const appPfx of (appResp.CommonPrefixes||[])) {
        const appId = appPfx.Prefix.match(/app_id=([^/]+)/)?.[1];
        if (!APP_IDS.includes(appId)) continue;
        const fResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: appPfx.Prefix, MaxKeys: 30 }));
        for (const f of (fResp.Contents||[]).filter(o=>o.Size>0&&o.Key.endsWith(".parquet"))) {
          const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: f.Key }));
          const chunks = []; for await (const c of resp.Body) chunks.push(c);
          const buf = Buffer.concat(chunks);
          const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength);
          const meta = parquetMetadata(ab);
          const allCols = meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);
          await parquetRead({ file: ab, onComplete: rawRows => {
            for (const row of rawRows) {
              const obj = { _app: appId };
              for (const col of wantCols) {
                const idx = allCols.indexOf(col);
                obj[col] = idx>=0 ? row[idx] : null;
              }
              if (filterFn(obj)) rows.push(obj);
            }
          }});
        }
      }
    }
    process.stderr.write(`  ${tbl}/${dt} done\n`);
  }
  return rows;
}

// ── 1. Google installs: ALL available dates ──
process.stderr.write("=== 1. Google installs (all dates) ===\n");
const ALL_DTS = ["dt=2026-06-30","dt=2026-07-01","dt=2026-07-02","dt=2026-07-03","dt=2026-07-04","dt=2026-07-05","dt=2026-07-06","dt=2026-07-07"];
const installs = await readFiles("installs", ALL_DTS,
  ["install_time","media_source","campaign","country_code","platform","appsflyer_id"],
  "install_time",
  r => isGoogle(r.media_source));

// group by KST date
const instByDate = {};
installs.forEach(r => {
  const d = new Date(r.install_time);
  const kst = new Date(d.getTime()+9*3600000).toISOString().slice(0,10);
  if (!instByDate[kst]) instByDate[kst] = [];
  instByDate[kst].push(r);
});
process.stdout.write("\n=== Google installs by KST date ===\n");
Object.keys(instByDate).sort().forEach(kd => {
  const rows = instByDate[kd];
  process.stdout.write(`${kd}: ${rows.length}건\n`);
  const byCamp = {};
  rows.forEach(r => { byCamp[r.campaign]=(byCamp[r.campaign]||0)+1; });
  Object.entries(byCamp).forEach(([c,n]) => process.stdout.write(`  campaign: ${c} (${n})\n`));
  const byCountry = {};
  rows.forEach(r => { byCountry[r.country_code]=(byCountry[r.country_code]||0)+1; });
  process.stdout.write(`  countries: ${Object.entries(byCountry).map(([c,n])=>`${c}:${n}`).join(', ')}\n`);
});
process.stdout.write(`총 Google installs: ${installs.length}\n`);

// ── 2. 7/7 KST Google in-app events detail ──
process.stderr.write("\n=== 2. Google inapps 7/7 KST ===\n");
const inapps = await readFiles("inapps", ["dt=2026-07-06","dt=2026-07-07"],
  ["event_time","event_name","event_value","event_revenue_usd","media_source","campaign","country_code","platform","appsflyer_id"],
  "event_time",
  r => isGoogle(r.media_source) && isKST77(r.event_time));

process.stdout.write("\n=== Google 인앱 이벤트 상세 (7/7 KST) ===\n");
process.stdout.write(`총 ${inapps.length}건\n\n`);
const byEvent = {};
inapps.forEach(r => {
  const en = r.event_name || 'unknown';
  if (!byEvent[en]) byEvent[en] = { count:0, revenue:0, users:new Set() };
  byEvent[en].count++;
  byEvent[en].revenue += parseFloat(r.event_revenue_usd)||0;
  if (r.appsflyer_id) byEvent[en].users.add(r.appsflyer_id);
});
Object.entries(byEvent).sort((a,b)=>b[1].count-a[1].count).forEach(([en,v]) => {
  process.stdout.write(`  ${en}: ${v.count}건, 유저 ${v.users.size}명, 매출 $${v.revenue.toFixed(2)}\n`);
});

// ── 3. creative_report: Google campaign cost ──
process.stderr.write("\n=== 3. creative_report Google cost ===\n");
const crPrefix = `${BASE}t=creative_report/`;
const dtResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: crPrefix, Delimiter: "/", MaxKeys: 20 }));
const crDates = (dtResp.CommonPrefixes||[]).map(p=>p.Prefix.replace(crPrefix,"").replace(/\/$/,"")).sort();

const googleCost = {}; // campaign -> {cost, impressions, clicks, installs}
for (const dt of crDates.slice(-3)) { // last 3 dates to avoid duplicates
  const hResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${crPrefix}${dt}/`, Delimiter: "/", MaxKeys: 20 }));
  for (const hPfx of (hResp.CommonPrefixes||[])) {
    const appResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: hPfx.Prefix, Delimiter: "/", MaxKeys: 10 }));
    for (const appPfx of (appResp.CommonPrefixes||[])) {
      const appId = appPfx.Prefix.match(/app_id=([^/]+)/)?.[1];
      if (!APP_IDS.includes(appId)) continue;
      const fResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: appPfx.Prefix, MaxKeys: 10 }));
      for (const f of (fResp.Contents||[]).filter(o=>o.Size>0&&o.Key.endsWith(".parquet"))) {
        const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: f.Key }));
        const chunks = []; for await (const c of resp.Body) chunks.push(c);
        const buf = Buffer.concat(chunks);
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength);
        const meta = parquetMetadata(ab);
        const allCols = meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);
        await parquetRead({ file: ab, onComplete: rows => {
          for (const row of rows) {
            const get = col => { const i=allCols.indexOf(col); return i>=0?row[i]:null; };
            const media = get("media_source")||"";
            if (!isGoogle(media)) continue;
            const camp = get("campaign")||"unknown";
            const cost = parseFloat(get("cost"))||0;
            const impr = parseFloat(get("impressions"))||0;
            const clks = parseFloat(get("clicks"))||0;
            const inst = parseFloat(get("installs"))||0;
            if (!googleCost[camp]) googleCost[camp] = { media, cost:0, impressions:0, clicks:0, installs:0, dt };
            googleCost[camp].cost += cost;
            googleCost[camp].impressions += impr;
            googleCost[camp].clicks += clks;
            googleCost[camp].installs += inst;
          }
        }});
      }
    }
  }
  process.stderr.write(`  creative_report/${dt} done\n`);
}

process.stdout.write("\n=== Google 캠페인 비용 (creative_report) ===\n");
if (Object.keys(googleCost).length === 0) {
  process.stdout.write("  → Google 캠페인 비용 데이터 없음\n");
} else {
  Object.entries(googleCost).forEach(([camp, v]) => {
    const cpi = v.installs > 0 ? (v.cost/v.installs).toFixed(2) : 'N/A';
    process.stdout.write(`캠페인: ${camp}\n`);
    process.stdout.write(`  비용: $${v.cost.toFixed(2)} | 노출: ${v.impressions.toFixed(0)} | 클릭: ${v.clicks.toFixed(0)} | 설치: ${v.installs.toFixed(0)} | CPI: $${cpi}\n`);
  });
}
