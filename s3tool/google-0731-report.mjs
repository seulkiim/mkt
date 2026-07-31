import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const OS_OF = { "com.albus.idolharvest": "Android", "id6756664337": "iOS" };
const APP_IDS = Object.keys(OS_OF);
const TARGET = "2026-07-31";
const MEDIA_MATCH = m => m && String(m).toLowerCase().includes("google");

function toKSTDate(ts) { if (ts == null) return null; const s = String(ts); const norm = s.replace(" ", "T") + (s.includes("T") || s.includes("+") ? "" : "Z"); const d = typeof ts === "number" ? new Date(ts) : new Date(norm); return isNaN(d.getTime()) ? null : new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10); }
function daysBetween(d1, d2) { return Math.round((Date.parse(d2 + "T00:00:00Z") - Date.parse(d1 + "T00:00:00Z")) / 86400000); }
function num(v) { return v == null ? 0 : (typeof v === "bigint" ? Number(v) : (parseFloat(v) || 0)); }
async function listParquet(prefix) { const files = []; let token; do { const r = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000, ContinuationToken: token })); for (const o of (r.Contents || [])) if (o.Size > 0 && o.Key.endsWith(".parquet")) files.push(o.Key); token = r.NextContinuationToken; } while (token); return files; }
async function listPrefixes(prefix) { const r = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, Delimiter: "/", MaxKeys: 1000 })); return (r.CommonPrefixes || []).map(p => p.Prefix); }
async function readParquet(key, wantCols) { const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key })); const chunks = []; for await (const c of resp.Body) chunks.push(c); const buf = Buffer.concat(chunks); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); const meta = parquetMetadata(ab); const allCols = meta.schema.filter(s => s.name && s.name !== "spark_schema").map(s => s.name); const present = wantCols.filter(c => allCols.includes(c)); const rows = []; await parquetRead({ file: ab, metadata: meta, columns: present, rowFormat: "object", onComplete: raw => { for (const row of raw) { const o = {}; for (const c of wantCols) o[c] = present.includes(c) ? row[c] : null; rows.push(o); } } }); return rows; }

function campLabel(raw, media) {
  let s = raw == null ? "" : String(raw).trim();
  if (s) { const parts = s.split("_"); if (parts.length > 3 && parts[3] === "m1") { parts[3] = "ua"; s = parts.join("_"); } return s; }
  return media === "organic" ? "(organic)" : "(no campaign)";
}
function campCountry(name) { const parts = String(name || "").split("_"); const i = parts.indexOf("if"); const tok = (i >= 0 ? parts[i + 1] : parts[2]) || ""; const m = tok.match(/^[a-z]+/i); return m ? m[0].toUpperCase() : "??"; }
function campCountryStrict(name) { const c = campCountry(name); return (c !== "WW" && c !== "??") ? c : null; }

// key: campaign|||country -> metrics
const R = {};
const K = (camp, c) => `${camp}|||${c}`;
function get(camp, c) { const k = K(camp, c); if (!R[k]) R[k] = { campaign: camp, country: c, cost: 0, imp: 0, clk: 0, install: 0, d0_iap: 0, d0_iaa: 0, d1_iaa: 0 }; return R[k]; }

// ══ 1. COST/IMP/CLK — cost_etl_geo, dt=2026-07-31, 최신 v= 스냅샷 ══
process.stderr.write("[1] cost/imp/clk\n");
{
  const dtPrefix = `${BASE}t=cost_etl_geo/dt=${TARGET}/`;
  const vs = (await listPrefixes(dtPrefix)).map(p => ({ v: parseInt(p.match(/v=(\d+)/)?.[1] ?? "-1"), prefix: p })).filter(x => x.v >= 0).sort((a, b) => b.v - a.v);
  if (vs.length) {
    for (const f of await listParquet(vs[0].prefix)) {
      const rows = await readParquet(f, ["app_id", "media_source", "date", "geo", "campaign", "cost", "impressions", "clicks"]);
      for (const r of rows) {
        if (!OS_OF[r.app_id]) continue;
        if (!MEDIA_MATCH(r.media_source)) continue;
        const kd = r.date ? String(r.date).slice(0, 10) : null; if (kd !== TARGET) continue;
        const camp = campLabel(r.campaign, r.media_source);
        const country = campCountryStrict(r.campaign) || (r.geo || "??");
        const e = get(camp, country);
        e.cost += num(r.cost); e.imp += num(r.impressions); e.clk += num(r.clicks);
      }
    }
    process.stderr.write(`  snapshot v=${vs[0].v} 사용\n`);
  } else {
    process.stderr.write("  dt=2026-07-31 cost_etl_geo 스냅샷 없음 (아직 미도착 가능)\n");
  }
}

// ══ 2. installs — t=installs/dt=2026-07-31/h=*/app_id=*/  ══
process.stderr.write("[2] installs\n");
{
  const base = `${BASE}t=installs/dt=${TARGET}/`;
  for (const hp of await listPrefixes(base)) {
    for (const appId of APP_IDS) {
      for (const f of await listParquet(`${hp}app_id=${appId}/`)) {
        const rows = await readParquet(f, ["install_time", "media_source", "country_code", "campaign"]);
        for (const r of rows) {
          if (!MEDIA_MATCH(r.media_source)) continue;
          const kd = toKSTDate(r.install_time); if (kd !== TARGET) continue;
          const camp = campLabel(r.campaign, r.media_source);
          const country = campCountryStrict(r.campaign) || (r.country_code || "??");
          get(camp, country).install++;
        }
      }
    }
  }
}

// ══ 3. IAP (inapps, af_purchase) — install=7/31, dd<=0 (D0) ══
process.stderr.write("[3] IAP d0\n");
{
  const base = `${BASE}t=inapps/dt=${TARGET}/`;
  for (const hp of await listPrefixes(base)) {
    for (const appId of APP_IDS) {
      for (const f of await listParquet(`${hp}app_id=${appId}/`)) {
        const rows = await readParquet(f, ["event_time", "install_time", "event_name", "event_revenue_usd", "media_source", "country_code", "campaign"]);
        for (const r of rows) {
          if (r.event_name !== "af_purchase") continue;
          if (!MEDIA_MATCH(r.media_source)) continue;
          const rev = parseFloat(r.event_revenue_usd) || 0; if (rev <= 0) continue;
          const ind = toKSTDate(r.install_time); if (ind !== TARGET) continue;
          const evd = toKSTDate(r.event_time); if (!evd) continue;
          const dd = Math.max(0, daysBetween(ind, evd)); if (dd > 0) continue; // D0만
          const camp = campLabel(r.campaign, r.media_source);
          const country = campCountryStrict(r.campaign) || (r.country_code || "??");
          get(camp, country).d0_iap += rev;
        }
      }
    }
  }
}

// ══ 4. IAA (ad_revenue v2 3종) — install=7/31, dd<=0(D0) 및 dd<=1(D1) ══
process.stderr.write("[4] IAA d0/d1\n");
for (const tbl of ["attributed_ad_revenue_v2", "organic_ad_revenue_v2", "retargeting_ad_revenue_v2"]) {
  const dtPrefix = `${BASE}t=${tbl}/dt=${TARGET}/`;
  const vs = (await listPrefixes(dtPrefix)).map(p => ({ v: parseInt(p.match(/version=(\d+)/)?.[1] ?? "-1"), prefix: p })).filter(x => x.v >= 0).sort((a, b) => b.v - a.v);
  if (!vs.length) { process.stderr.write(`  ${tbl}: dt=${TARGET} 스냅샷 없음\n`); continue; }
  for (const appId of APP_IDS) {
    for (const f of await listParquet(`${vs[0].prefix}app_id=${appId}/`)) {
      const rows = await readParquet(f, ["event_time", "install_time", "event_revenue_usd", "media_source", "country_code", "campaign"]);
      for (const r of rows) {
        if (!MEDIA_MATCH(r.media_source)) continue;
        const rev = parseFloat(r.event_revenue_usd) || 0; if (rev <= 0) continue;
        const ind = toKSTDate(r.install_time); if (ind !== TARGET) continue;
        const evd = toKSTDate(r.event_time); if (!evd) continue;
        const dd = Math.max(0, daysBetween(ind, evd));
        const camp = campLabel(r.campaign, r.media_source);
        const country = campCountryStrict(r.campaign) || (r.country_code || "??");
        const e = get(camp, country);
        if (dd <= 0) e.d0_iaa += rev;
        if (dd <= 1) e.d1_iaa += rev;
      }
    }
  }
  process.stderr.write(`  ${tbl} v=${vs[0].v} 처리 완료\n`);
}

// ══ BUILD & PRINT ══
const out = Object.values(R).map(e => {
  const d0_rev = e.d0_iap + e.d0_iaa;
  return {
    campaign: e.campaign, country: e.country,
    cost: +e.cost.toFixed(2), install: e.install,
    cpi: e.install > 0 ? +(e.cost / e.install).toFixed(2) : null,
    impression: Math.round(e.imp), click: Math.round(e.clk),
    cpm: e.imp > 0 ? +(e.cost * 1000 / e.imp).toFixed(2) : null,
    ctr: e.imp > 0 ? +(e.clk / e.imp * 100).toFixed(2) : null,
    d0_roas: e.cost > 0 ? +(d0_rev / e.cost * 100).toFixed(1) : null,
    d0_revenue: +d0_rev.toFixed(2),
    d1_iaa_revenue: +e.d1_iaa.toFixed(2),
    d0_iap_revenue: +e.d0_iap.toFixed(2),
  };
});
out.sort((a, b) => b.cost - a.cost);

console.log(`\n===== ${TARGET} Google 매체 성과 — 캠페인 x 국가 (cost desc) =====\n`);
console.log("campaign".padEnd(45) + "country".padEnd(9) + "cost".padStart(9) + "install".padStart(8) + "cpi".padStart(8) + "impression".padStart(11) + "click".padStart(8) + "cpm".padStart(8) + "ctr%".padStart(7) + "d0_roas%".padStart(9) + "d0_rev".padStart(9) + "d1_iaa".padStart(9) + "d0_iap".padStart(9));
for (const r of out) {
  console.log(
    r.campaign.padEnd(45) + r.country.padEnd(9) +
    ("$" + r.cost.toFixed(0)).padStart(9) +
    String(r.install).padStart(8) +
    (r.cpi != null ? "$" + r.cpi.toFixed(2) : "-").padStart(8) +
    String(r.impression).padStart(11) +
    String(r.click).padStart(8) +
    (r.cpm != null ? "$" + r.cpm.toFixed(2) : "-").padStart(8) +
    (r.ctr != null ? r.ctr.toFixed(2) : "-").padStart(7) +
    (r.d0_roas != null ? r.d0_roas.toFixed(1) : "-").padStart(9) +
    ("$" + r.d0_revenue.toFixed(1)).padStart(9) +
    ("$" + r.d1_iaa_revenue.toFixed(1)).padStart(9) +
    ("$" + r.d0_iap_revenue.toFixed(1)).padStart(9)
  );
}
const tot = out.reduce((a, r) => ({ cost: a.cost + r.cost, install: a.install + r.install, imp: a.imp + r.impression, clk: a.clk + r.click, d0: a.d0 + r.d0_revenue, d1iaa: a.d1iaa + r.d1_iaa_revenue, d0iap: a.d0iap + r.d0_iap_revenue }), { cost: 0, install: 0, imp: 0, clk: 0, d0: 0, d1iaa: 0, d0iap: 0 });
console.log("\n합계: cost=$" + tot.cost.toFixed(0) + " install=" + tot.install + " imp=" + tot.imp + " clk=" + tot.clk + " d0_rev=$" + tot.d0.toFixed(1) + " d1_iaa=$" + tot.d1iaa.toFixed(1) + " d0_iap=$" + tot.d0iap.toFixed(1) + " d0_roas=" + (tot.cost > 0 ? (tot.d0 / tot.cost * 100).toFixed(1) : "-") + "%");

console.log(JSON.stringify(out));
