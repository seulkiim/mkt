import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";
const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["id6756664337"]; // iOS only
const START = "2026-07-07", END = "2026-07-22";
function toKST(ts) { if (ts == null) return null; const s = String(ts); const n = s.replace(" ", "T") + (s.includes("T") || s.includes("+") ? "" : "Z"); const d = typeof ts === "number" ? new Date(ts) : new Date(n); return isNaN(d) ? null : new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10); }
function days(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
const inR = d => d >= START && d <= END;
async function lp(p) { const f = []; let t; do { const r = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: p, MaxKeys: 1000, ContinuationToken: t })); for (const o of (r.Contents || [])) if (o.Size > 0 && o.Key.endsWith(".parquet")) f.push(o.Key); t = r.NextContinuationToken; } while (t); return f; }
async function lpre(p) { const r = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: p, Delimiter: "/", MaxKeys: 1000 })); return (r.CommonPrefixes || []).map(x => x.Prefix); }
async function rp(key, cols) { const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key })); const ch = []; for await (const c of resp.Body) ch.push(c); const buf = Buffer.concat(ch); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); const meta = parquetMetadata(ab); const all = meta.schema.filter(s => s.name && s.name !== "spark_schema").map(s => s.name); const idx = cols.map(c => all.indexOf(c)); const rows = []; await parquetRead({ file: ab, onComplete: raw => { for (const row of raw) { const o = {}; cols.forEach((c, i) => o[c] = idx[i] >= 0 ? row[idx[i]] : null); rows.push(o); } } }); return rows; }
async function dts(tbl) { const b = `${BASE}t=${tbl}/`; return (await lpre(b)).map(p => p.replace(b, "").replace(/\/$/, "")).filter(d => d >= "dt=2026-07-06").sort(); }

// key: country|date(install cohort) -> {imp, rev, n}
const B = {};
function add(c, d, imp, rev) { const k = c + "|" + d; if (!B[k]) B[k] = { imp: 0, rev: 0, n: 0 }; B[k].imp += imp; B[k].rev += rev; B[k].n++; }

for (const tbl of ["attributed_ad_revenue_v2", "organic_ad_revenue_v2", "retargeting_ad_revenue_v2"]) {
  for (const dt of await dts(tbl)) {
    const vs = (await lpre(`${BASE}t=${tbl}/${dt}/`)).map(p => ({ v: parseInt(p.match(/version=(\d+)/)?.[1] ?? "-1"), prefix: p })).filter(x => x.v >= 0).sort((a, b) => b.v - a.v);
    if (!vs.length) continue;
    for (const appId of APP_IDS) {
      for (const f of await lp(`${vs[0].prefix}app_id=${appId}/`)) {
        for (const r of await rp(f, ["event_time", "install_time", "event_revenue_usd", "country_code", "impressions"])) {
          const rev = parseFloat(r.event_revenue_usd) || 0; if (rev <= 0) continue;
          const cc = r.country_code;
          if (cc !== "JP" && cc !== "KR") continue;
          const ind = toKST(r.install_time); if (!ind || !inR(ind)) continue;
          const evd = toKST(r.event_time); if (!evd) continue;
          const dd = Math.max(0, days(ind, evd)); if (dd > 1) continue; // D1 window
          add(cc, ind, parseFloat(r.impressions) || 0, rev);
        }
      }
    }
  }
  process.stderr.write(`${tbl} done\n`);
}

const dates = []; for (let t = Date.parse(START + "T00:00:00Z"); t <= Date.parse(END + "T00:00:00Z"); t += 86400000) dates.push(new Date(t).toISOString().slice(0, 10));

for (const country of ["JP", "KR"]) {
  console.log(`\n===== ${country} (iOS) D1 광고매출 — 일자별 노출/eCPM (raw impression-level) =====`);
  console.log("  date       imp(D1)      rev(D1)     eCPM    rec수");
  for (const d of dates) {
    const b = B[country + "|" + d];
    if (!b) { console.log("  " + d.slice(5) + "   (no data)"); continue; }
    const ecpm = b.imp > 0 ? b.rev / b.imp * 1000 : 0;
    console.log("  " + d.slice(5) + String(Math.round(b.imp)).padStart(10) + ("$" + b.rev.toFixed(1)).padStart(11) + ("$" + ecpm.toFixed(2)).padStart(9) + String(b.n).padStart(8));
  }
}

function sumRange(country, start, end) {
  const ds = dates.filter(d => d >= start && d <= end);
  const agg = { imp: 0, rev: 0, n: 0 };
  for (const d of ds) { const b = B[country + "|" + d]; if (!b) continue; agg.imp += b.imp; agg.rev += b.rev; agg.n += b.n; }
  return agg;
}
console.log("\n===== 기준(7/07~7/13) vs 하락(7/14~7/22) eCPM 비교 =====");
for (const country of ["JP", "KR"]) {
  const base = sumRange(country, "2026-07-07", "2026-07-13");
  const decl = sumRange(country, "2026-07-14", "2026-07-22");
  const be = base.imp > 0 ? base.rev / base.imp * 1000 : 0, de = decl.imp > 0 ? decl.rev / decl.imp * 1000 : 0;
  console.log(`\n■ ${country}`);
  console.log(`  기준 : imp=${Math.round(base.imp)} rev=$${base.rev.toFixed(1)} eCPM=$${be.toFixed(2)} rec=${base.n}`);
  console.log(`  하락 : imp=${Math.round(decl.imp)} rev=$${decl.rev.toFixed(1)} eCPM=$${de.toFixed(2)} rec=${decl.n}`);
  console.log(`  변화 : eCPM ${((de/be-1)*100).toFixed(1)}%  /  imp합계 ${((decl.imp/base.imp-1)*100).toFixed(1)}%`);
}
