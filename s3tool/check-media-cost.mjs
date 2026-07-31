import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];

const MEDIA_MAP = {
  google:    m => m && /google/i.test(m),
  facebook:  m => m && /facebook|meta/i.test(m),
  applovin:  m => m && /applovin/i.test(m),
  liftoff:   m => m && /liftoff/i.test(m),
};

function classify(media) {
  for (const [key, fn] of Object.entries(MEDIA_MAP)) {
    if (fn(media)) return key;
  }
  return null;
}

async function readAllFiles(tbl, wantCols) {
  const prefix = `${BASE}t=${tbl}/`;
  const dtResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, Delimiter: "/", MaxKeys: 50 }));
  const dates = (dtResp.CommonPrefixes||[]).map(p=>p.Prefix.replace(prefix,"").replace(/\/$/,"")).sort();

  const rows = [];
  for (const dt of dates) {
    const sub1 = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}${dt}/`, Delimiter: "/", MaxKeys: 50 }));
    for (const s1 of (sub1.CommonPrefixes||[])) {
      const sub2 = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: s1.Prefix, Delimiter: "/", MaxKeys: 10 }));
      for (const s2 of (sub2.CommonPrefixes||[])) {
        const appId = s2.Prefix.match(/app_id=([^/]+)/)?.[1];
        if (!APP_IDS.includes(appId)) continue;
        const fResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: s2.Prefix, MaxKeys: 30 }));
        for (const f of (fResp.Contents||[]).filter(o=>o.Size>0&&o.Key.endsWith(".parquet"))) {
          const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: f.Key }));
          const chunks = []; for await (const c of resp.Body) chunks.push(c);
          const buf = Buffer.concat(chunks);
          const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength);
          const meta = parquetMetadata(ab);
          const allCols = meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);
          await parquetRead({ file: ab, onComplete: rawRows => {
            for (const row of rawRows) {
              const obj = { _dt: dt, _app: appId };
              for (const col of wantCols) {
                const idx = allCols.indexOf(col);
                obj[col] = idx>=0 ? row[idx] : null;
              }
              rows.push(obj);
            }
          }});
        }
      }
    }
    process.stderr.write(`  ${tbl}/${dt}\n`);
  }
  return rows;
}

// ── 1. Installs: count by media, date ──
process.stderr.write("=== installs ===\n");
const instRows = await readAllFiles("installs", ["install_time","media_source","campaign","country_code","platform"]);

const instByMedia = { google:0, facebook:0, applovin:0, liftoff:0 };
const instByMediaDate = {}; // media -> date(KST) -> count
const instRawMedia = {};

for (const r of instRows) {
  const m = r.media_source || "organic";
  const key = classify(m);
  // KST date
  const kd = r.install_time
    ? new Date(new Date(r.install_time).getTime()+9*3600000).toISOString().slice(0,10)
    : null;

  instRawMedia[m] = (instRawMedia[m]||0)+1;
  if (!key) continue;
  instByMedia[key]++;
  if (kd) {
    if (!instByMediaDate[key]) instByMediaDate[key] = {};
    instByMediaDate[key][kd] = (instByMediaDate[key][kd]||0)+1;
  }
}

process.stdout.write("\n=== 전체 매체별 설치 (Data Locker 기간 전체) ===\n");
Object.entries(instRawMedia).sort((a,b)=>b[1]-a[1]).forEach(([m,n])=>{
  const key = classify(m);
  process.stdout.write(`  [${key||'-'}] ${m}: ${n}건\n`);
});

// ── 2. creative_report: cost by media (use ONLY latest date to avoid duplicate cumulative) ──
process.stderr.write("\n=== creative_report (latest date only) ===\n");
const crPrefix = `${BASE}t=creative_report/`;
const crDtResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: crPrefix, Delimiter: "/", MaxKeys: 20 }));
const crDates = (crDtResp.CommonPrefixes||[]).map(p=>p.Prefix.replace(crPrefix,"").replace(/\/$/,"")).sort();
const latestDt = crDates.at(-1);
process.stderr.write(`  using: ${latestDt}\n`);

const costByMedia = { google:{cost:0,impressions:0,clicks:0,installs:0,campaigns:{}}, facebook:{cost:0,impressions:0,clicks:0,installs:0,campaigns:{}}, applovin:{cost:0,impressions:0,clicks:0,installs:0,campaigns:{}}, liftoff:{cost:0,impressions:0,clicks:0,installs:0,campaigns:{}} };

const sub1 = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${crPrefix}${latestDt}/`, Delimiter: "/", MaxKeys: 20 }));
for (const s1 of (sub1.CommonPrefixes||[])) {
  const sub2 = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: s1.Prefix, Delimiter: "/", MaxKeys: 10 }));
  for (const s2 of (sub2.CommonPrefixes||[])) {
    const appId = s2.Prefix.match(/app_id=([^/]+)/)?.[1];
    if (!APP_IDS.includes(appId)) continue;
    const fResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: s2.Prefix, MaxKeys: 10 }));
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
          const key = classify(media);
          if (!key) continue;
          const camp = get("campaign")||"unknown";
          const cost = parseFloat(get("cost"))||0;
          const impr = parseFloat(get("impressions"))||0;
          const clks = parseFloat(get("clicks"))||0;
          const inst = parseFloat(get("installs"))||0;
          const platform = appId==="id6756664337"?"ios":"android";
          costByMedia[key].cost += cost;
          costByMedia[key].impressions += impr;
          costByMedia[key].clicks += clks;
          costByMedia[key].installs += inst;
          const ck = `${camp}|||${platform}`;
          if (!costByMedia[key].campaigns[ck]) costByMedia[key].campaigns[ck] = {camp,platform,cost:0,impressions:0,clicks:0,installs:0};
          costByMedia[key].campaigns[ck].cost += cost;
          costByMedia[key].campaigns[ck].impressions += impr;
          costByMedia[key].campaigns[ck].clicks += clks;
          costByMedia[key].campaigns[ck].installs += inst;
        }
      }});
    }
  }
}

// ── Output ──
process.stdout.write("\n\n=== 매체별 Cost / Install / CPI (creative_report 누적 기준) ===\n");
process.stdout.write("* creative_report는 누적 스냅샷으로 일별 비용 분리 불가\n\n");
for (const [key, v] of Object.entries(costByMedia)) {
  const instCount = instByMedia[key];
  const crInst = v.installs;
  const cpi_cr = crInst > 0 ? (v.cost/crInst).toFixed(2) : 'N/A';
  const cpi_af = instCount > 0 ? (v.cost/instCount).toFixed(2) : 'N/A';
  process.stdout.write(`── ${key.toUpperCase()} ──\n`);
  process.stdout.write(`  비용(creative_report): $${v.cost.toFixed(2)}\n`);
  process.stdout.write(`  노출: ${v.impressions.toFixed(0)}  |  클릭: ${v.clicks.toFixed(0)}\n`);
  process.stdout.write(`  설치(creative_report 기준): ${crInst.toFixed(0)}  |  설치(installs 테이블): ${instCount}\n`);
  process.stdout.write(`  CPI (cr기준): $${cpi_cr}  |  CPI (af installs기준): $${cpi_af}\n`);
  const camps = Object.values(v.campaigns).sort((a,b)=>b.cost-a.cost);
  if (camps.length) {
    process.stdout.write(`  캠페인:\n`);
    camps.forEach(c => {
      const cpi = c.installs>0?(c.cost/c.installs).toFixed(2):'N/A';
      process.stdout.write(`    [${c.platform}] ${c.camp}\n`);
      process.stdout.write(`      Cost:$${c.cost.toFixed(2)} | Impr:${c.impressions.toFixed(0)} | Clicks:${c.clicks.toFixed(0)} | Install:${c.installs.toFixed(0)} | CPI:$${cpi}\n`);
    });
  } else {
    process.stdout.write(`  → creative_report 비용 없음\n`);
  }
  process.stdout.write("\n");
}
