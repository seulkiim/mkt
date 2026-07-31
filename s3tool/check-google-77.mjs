import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];

// 7/7 KST = 7/6 UTC → dt=2026-07-06
// Also check dt=2026-07-07 for late KST events (KST 7/7 0:00 ~ 23:59 = UTC 7/6 15:00 ~ 7/7 14:59)
const TARGET_DTS = ["dt=2026-07-06", "dt=2026-07-07"];
const KST_START = new Date("2026-07-07T00:00:00+09:00");
const KST_END   = new Date("2026-07-07T23:59:59+09:00");

function isKST77(ts) {
  if (!ts) return false;
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  return d >= KST_START && d <= KST_END;
}

const GOOGLE_KEYWORDS = ["google", "adwords", "googleads", "google_ads", "universal app", "uac"];

function isGoogle(media) {
  if (!media) return false;
  return GOOGLE_KEYWORDS.some(kw => media.toLowerCase().includes(kw));
}

async function scanTable(tbl, wantCols, timeCol) {
  const prefix = `${BASE}t=${tbl}/`;
  const results = [];

  for (const dt of TARGET_DTS) {
    const hResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}${dt}/`, Delimiter: "/", MaxKeys: 50 }));
    if (!hResp.CommonPrefixes?.length) { process.stderr.write(`  ${tbl}/${dt}: no data\n`); continue; }

    for (const hPfx of (hResp.CommonPrefixes||[])) {
      const appResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: hPfx.Prefix, Delimiter: "/", MaxKeys: 10 }));
      for (const appPfx of (appResp.CommonPrefixes||[])) {
        const appId = appPfx.Prefix.match(/app_id=([^/]+)/)?.[1];
        if (!APP_IDS.includes(appId)) continue;
        const fResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: appPfx.Prefix, MaxKeys: 20 }));
        for (const f of (fResp.Contents||[]).filter(o=>o.Size>0&&o.Key.endsWith(".parquet"))) {
          const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: f.Key }));
          const chunks = []; for await (const c of resp.Body) chunks.push(c);
          const buf = Buffer.concat(chunks);
          const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength);
          const meta = parquetMetadata(ab);
          const allCols = meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);
          await parquetRead({ file: ab, onComplete: rows => {
            for (const row of rows) {
              const obj = { _appId: appId };
              for (const col of wantCols) {
                const idx = allCols.indexOf(col);
                obj[col] = idx>=0 ? row[idx] : null;
              }
              const ts = obj[timeCol];
              if (!isKST77(ts)) continue;
              results.push(obj);
            }
          }});
        }
      }
    }
    process.stderr.write(`  ${tbl}/${dt}: scanned\n`);
  }

  return results;
}

// ── installs ──
process.stderr.write("Scanning installs...\n");
const instRows = await scanTable("installs",
  ["install_time","media_source","campaign","af_channel","country_code","platform","appsflyer_id"],
  "install_time");

const googleInst = instRows.filter(r => isGoogle(r.media_source));
const allMediaInst = {};
instRows.forEach(r => { const m = r.media_source||'organic'; allMediaInst[m]=(allMediaInst[m]||0)+1; });

process.stdout.write("\n=== 7/7 KST INSTALLS ===\n");
process.stdout.write(`Total installs: ${instRows.length}\n`);
process.stdout.write("By media_source:\n");
Object.entries(allMediaInst).sort((a,b)=>b[1]-a[1]).forEach(([m,c])=>process.stdout.write(`  ${m}: ${c}\n`));
process.stdout.write(`Google installs: ${googleInst.length}\n`);
if (googleInst.length > 0) {
  googleInst.forEach(r => process.stdout.write(`  ${JSON.stringify({media:r.media_source,campaign:r.campaign,country:r.country_code,platform:r.platform})}\n`));
}

// ── clicks ──
process.stderr.write("Scanning clicks...\n");
const clkRows = await scanTable("clicks",
  ["click_time","media_source","campaign","af_channel","country_code","platform"],
  "click_time");

const googleClk = clkRows.filter(r => isGoogle(r.media_source));
const allMediaClk = {};
clkRows.forEach(r => { const m = r.media_source||'?'; allMediaClk[m]=(allMediaClk[m]||0)+1; });

process.stdout.write("\n=== 7/7 KST CLICKS ===\n");
process.stdout.write(`Total clicks: ${clkRows.length}\n`);
process.stdout.write("By media_source:\n");
Object.entries(allMediaClk).sort((a,b)=>b[1]-a[1]).forEach(([m,c])=>process.stdout.write(`  ${m}: ${c}\n`));
process.stdout.write(`Google clicks: ${googleClk.length}\n`);
if (googleClk.length > 0) {
  const byCamp = {};
  googleClk.forEach(r => { byCamp[r.campaign]=(byCamp[r.campaign]||0)+1; });
  Object.entries(byCamp).sort((a,b)=>b[1]-a[1]).forEach(([c,n])=>process.stdout.write(`  ${c}: ${n}회\n`));
}

// ── inapps ──
process.stderr.write("Scanning inapps...\n");
const inappsRows = await scanTable("inapps",
  ["event_time","event_name","event_revenue_usd","media_source","campaign","country_code","platform"],
  "event_time");

const googleInapps = inappsRows.filter(r => isGoogle(r.media_source));
const allMediaInapps = {};
inappsRows.forEach(r => { const m = r.media_source||'organic'; allMediaInapps[m]=(allMediaInapps[m]||0)+1; });

process.stdout.write("\n=== 7/7 KST IN-APP EVENTS ===\n");
process.stdout.write(`Total events: ${inappsRows.length}\n`);
process.stdout.write("By media_source:\n");
Object.entries(allMediaInapps).sort((a,b)=>b[1]-a[1]).forEach(([m,c])=>process.stdout.write(`  ${m}: ${c}\n`));
process.stdout.write(`Google in-app events: ${googleInapps.length}\n`);

process.stdout.write("\nDone\n");
