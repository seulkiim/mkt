import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";
import { writeFileSync } from "fs";

const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];

const KST_OFFSET = 9 * 3600 * 1000;
function toKSTDate(ts) {
  if (!ts) return null;
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  const kst = new Date(d.getTime() + KST_OFFSET);
  return kst.toISOString().slice(0, 10);
}

// List all files under a prefix
async function listFiles(prefix) {
  const files = [];
  let token;
  do {
    const resp = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000, ContinuationToken: token
    }));
    for (const obj of (resp.Contents || [])) {
      if (obj.Key.endsWith(".parquet") && obj.Size > 0) files.push(obj.Key);
    }
    token = resp.NextContinuationToken;
  } while (token);
  return files;
}

// Read parquet file and return rows as objects
async function readParquet(key, wantedCols) {
  const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = []; for await (const c of resp.Body) chunks.push(c);
  const buf = Buffer.concat(chunks);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const meta = parquetMetadata(ab);
  const allCols = meta.schema.filter(s => s.name && s.name !== "spark_schema").map(s => s.name);

  const rows = [];
  await parquetRead({ file: ab, onComplete: (rawRows) => {
    for (const row of rawRows) {
      const obj = {};
      for (const col of wantedCols) {
        const idx = allCols.indexOf(col);
        obj[col] = idx >= 0 ? row[idx] : null;
      }
      rows.push(obj);
    }
  }});
  return rows;
}

// ── 1. installs: get July KST install dates ──
// dt= UTC date, install_time in file
// July KST 7/1~7/7 = UTC 6/30~7/6
const INSTALL_DT_RANGE = ["dt=2026-06-30","dt=2026-07-01","dt=2026-07-02","dt=2026-07-03","dt=2026-07-04","dt=2026-07-05","dt=2026-07-06"];
const TARGET_KST_DATES = ["2026-07-01","2026-07-02","2026-07-03","2026-07-04","2026-07-05","2026-07-06","2026-07-07"];

process.stderr.write("=== Reading installs ===\n");
// install_key: appsflyer_id -> {install_kst_date, country_code, media_source, platform}
const installMap = {}; // appsflyer_id -> {date, country, media, platform}
const installStats = {}; // date -> country -> {installs, media}

for (const dt of INSTALL_DT_RANGE) {
  const prefix = `${BASE}t=installs/${dt}/`;
  const hResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, Delimiter: "/", MaxKeys: 50 }));
  for (const hPfx of (hResp.CommonPrefixes || [])) {
    const appResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: hPfx.Prefix, Delimiter: "/", MaxKeys: 10 }));
    for (const appPfx of (appResp.CommonPrefixes || [])) {
      const appId = appPfx.Prefix.split("app_id=")[1]?.replace("/","");
      if (!APP_IDS.includes(appId)) continue;
      const files = await listFiles(appPfx.Prefix);
      for (const key of files) {
        try {
          const rows = await readParquet(key, ["appsflyer_id","install_time","country_code","media_source","platform","bundle_id"]);
          for (const r of rows) {
            const kd = toKSTDate(r.install_time);
            if (!kd || !TARGET_KST_DATES.includes(kd)) continue;
            const country = r.country_code || "XX";
            const media = r.media_source || "organic";
            const platform = appId === "id6756664337" ? "ios" : "android";
            if (r.appsflyer_id) installMap[r.appsflyer_id] = { date: kd, country, media, platform };
            if (!installStats[kd]) installStats[kd] = {};
            if (!installStats[kd][country]) installStats[kd][country] = { installs: 0, media: {} };
            installStats[kd][country].installs++;
            installStats[kd][country].media[media] = (installStats[kd][country].media[media] || 0) + 1;
          }
        } catch(e) { process.stderr.write(`installs error: ${e.message.slice(0,60)}\n`); }
      }
    }
  }
  process.stderr.write(`installs ${dt} done\n`);
}

// ── 2. IAP revenue from inapps (af_purchase) ──
process.stderr.write("\n=== Reading IAP (inapps/af_purchase) ===\n");
// event_time KST determines Dx: Dx = event_kst_date - install_kst_date
// Revenue maps: date -> country -> dx -> iap_rev
const iapRev = {}; // install_kst_date -> country -> dx -> revenue

// Need to scan inapps for event dates covering D0~D2 of July installs
// 7/1 installs -> D0=7/1, D1=7/2, D2=7/3 (KST) -> UTC 6/30~7/2 -> dt=2026-06-30..07-02
// 7/7 installs -> D0=7/7, D1=7/8, D2=7/9 -> but today is 7/7 so D1/D2 incomplete
// Scan dt=2026-06-30 through dt=2026-07-08 to be safe
const INAPPS_DTS = ["dt=2026-06-30","dt=2026-07-01","dt=2026-07-02","dt=2026-07-03","dt=2026-07-04","dt=2026-07-05","dt=2026-07-06","dt=2026-07-07","dt=2026-07-08"];

for (const dt of INAPPS_DTS) {
  const prefix = `${BASE}t=inapps/${dt}/`;
  const hResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, Delimiter: "/", MaxKeys: 50 }));
  if (!hResp.CommonPrefixes?.length) continue;
  for (const hPfx of (hResp.CommonPrefixes || [])) {
    const appResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: hPfx.Prefix, Delimiter: "/", MaxKeys: 10 }));
    for (const appPfx of (appResp.CommonPrefixes || [])) {
      const appId = appPfx.Prefix.split("app_id=")[1]?.replace("/","");
      if (!APP_IDS.includes(appId)) continue;
      const files = await listFiles(appPfx.Prefix);
      for (const key of files) {
        try {
          const rows = await readParquet(key, ["appsflyer_id","event_name","event_revenue_usd","event_time","install_time","country_code","media_source"]);
          for (const r of rows) {
            if (r.event_name !== "af_purchase") continue;
            const rev = parseFloat(r.event_revenue_usd) || 0;
            if (rev <= 0) continue;
            // Use installMap for cohort info
            const info = r.appsflyer_id ? installMap[r.appsflyer_id] : null;
            const installKst = info ? info.date : toKSTDate(r.install_time);
            if (!installKst || !TARGET_KST_DATES.includes(installKst)) continue;
            const eventKst = toKSTDate(r.event_time);
            if (!eventKst) continue;
            const dx = (new Date(eventKst) - new Date(installKst)) / 86400000;
            if (dx < 0 || dx > 6) continue;
            const country = info ? info.country : (r.country_code || "XX");
            if (!iapRev[installKst]) iapRev[installKst] = {};
            if (!iapRev[installKst][country]) iapRev[installKst][country] = {};
            iapRev[installKst][country][dx] = (iapRev[installKst][country][dx] || 0) + rev;
          }
        } catch(e) { process.stderr.write(`inapps error ${key}: ${e.message.slice(0,60)}\n`); }
      }
    }
  }
  process.stderr.write(`inapps ${dt} done\n`);
}

// ── 3. IAA revenue from ad revenue tables ──
process.stderr.write("\n=== Reading IAA (ad_revenue tables) ===\n");
const iaaRev = {}; // install_kst_date -> country -> dx -> revenue

async function readAdRevTable(tbl) {
  const prefix = `${BASE}t=${tbl}/`;
  const dtResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, Delimiter: "/", MaxKeys: 50 }));
  const dates = (dtResp.CommonPrefixes||[]).map(p=>p.Prefix.replace(prefix,"").replace(/\/$/,"")).sort();
  process.stderr.write(`  ${tbl}: dates=${dates.join(",")}\n`);

  for (const dt of dates) {
    // These tables use version= partitioning, not h=
    const vResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}${dt}/`, Delimiter: "/", MaxKeys: 20 }));
    for (const vPfx of (vResp.CommonPrefixes||[])) {
      const appResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: vPfx.Prefix, Delimiter: "/", MaxKeys: 10 }));
      for (const appPfx of (appResp.CommonPrefixes||[])) {
        const appId = appPfx.Prefix.split("app_id=")[1]?.replace("/","");
        if (!APP_IDS.includes(appId)) continue;
        const files = await listFiles(appPfx.Prefix);
        for (const key of files) {
          try {
            const rows = await readParquet(key, ["appsflyer_id","event_revenue_usd","event_time","install_time","country_code","media_source"]);
            for (const r of rows) {
              const rev = parseFloat(r.event_revenue_usd) || 0;
              if (rev <= 0) continue;
              const info = r.appsflyer_id ? installMap[r.appsflyer_id] : null;
              const installKst = info ? info.date : toKSTDate(r.install_time);
              if (!installKst || !TARGET_KST_DATES.includes(installKst)) continue;
              const eventKst = toKSTDate(r.event_time);
              if (!eventKst) continue;
              const dx = (new Date(eventKst) - new Date(installKst)) / 86400000;
              if (dx < 0 || dx > 6) continue;
              const country = info ? info.country : (r.country_code || "XX");
              if (!iaaRev[installKst]) iaaRev[installKst] = {};
              if (!iaaRev[installKst][country]) iaaRev[installKst][country] = {};
              iaaRev[installKst][country][dx] = (iaaRev[installKst][country][dx] || 0) + rev;
            }
          } catch(e) { process.stderr.write(`  adrev error ${key}: ${e.message.slice(0,60)}\n`); }
        }
      }
    }
  }
}

await readAdRevTable("attributed_ad_revenue_v2");
await readAdRevTable("organic_ad_revenue_v2");
await readAdRevTable("retargeting_ad_revenue_v2");

// ── 4. Build result ──
const result = {
  installStats,    // date -> country -> {installs, media}
  iapRev,          // install_kst_date -> country -> dx -> revenue
  iaaRev,          // install_kst_date -> country -> dx -> revenue
  targetDates: TARGET_KST_DATES,
  generatedAt: new Date().toISOString()
};

writeFileSync("C:/Users/STZ940/s3tool/cohort-full-result.json", JSON.stringify(result, null, 2), "utf8");
process.stderr.write("\nDone! Saved to cohort-full-result.json\n");

// Quick summary
process.stdout.write("\n=== SUMMARY ===\n");
for (const kd of TARGET_KST_DATES) {
  const countries = Object.keys(installStats[kd] || {});
  const totalInstalls = countries.reduce((s,c) => s + (installStats[kd][c]?.installs||0), 0);
  let iap0=0, iap1=0, iap2=0, iaa0=0, iaa1=0, iaa2=0;
  for (const c of countries) {
    iap0 += iapRev[kd]?.[c]?.[0] || 0;
    iap1 += iapRev[kd]?.[c]?.[1] || 0;
    iap2 += iapRev[kd]?.[c]?.[2] || 0;
    iaa0 += iaaRev[kd]?.[c]?.[0] || 0;
    iaa1 += iaaRev[kd]?.[c]?.[1] || 0;
    iaa2 += iaaRev[kd]?.[c]?.[2] || 0;
  }
  process.stdout.write(`${kd}: installs=${totalInstalls}, IAP D0=$${iap0.toFixed(2)} D1=$${iap1.toFixed(2)} D2=$${iap2.toFixed(2)}, IAA D0=$${iaa0.toFixed(2)} D1=$${iaa1.toFixed(2)} D2=$${iaa2.toFixed(2)}\n`);
}
