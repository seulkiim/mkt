import { readFileSync } from "fs";
import { dataPath } from "./paths.mjs";
const d = JSON.parse(readFileSync(dataPath("geo-cohort-os-result.json"), "utf8"));
const rows = d.rows.filter(r => (r.country === "JP" || r.country === "KR") && r.os === "iOS");

const byDateCountry = {};
for (const r of rows) {
  const k = r.date + "|" + r.country;
  if (!byDateCountry[k]) byDateCountry[k] = { cost: 0, inst: 0, d1_iap: 0, d1_iaa: 0, d1: 0 };
  const b = byDateCountry[k];
  b.cost += r.cost || 0;
  b.inst += r.install_total || 0;
  b.d1_iap += r.rev_d1_iap || 0;
  b.d1_iaa += r.rev_d1_iaa || 0;
  b.d1 += r.rev_d1 || 0;
}

const dates = [...new Set(rows.map(r => r.date))].sort().filter(d => d <= "2026-07-22");

for (const country of ["JP", "KR"]) {
  console.log(`\n===== ${country} (iOS) — 일자별 D1 Cost/IAP/IAA (raw event 집계) =====`);
  console.log("  date        cost    inst   D1_IAP   D1_IAA   D1_total  D1_ROAS");
  for (const d of dates) {
    const b = byDateCountry[d + "|" + country];
    if (!b) { console.log("  " + d.slice(5)); continue; }
    const roas = b.cost > 0 ? (b.d1 / b.cost * 100).toFixed(1) + "%" : "-";
    console.log(
      "  " + d.slice(5) +
      ("$" + b.cost.toFixed(0)).padStart(9) +
      String(Math.round(b.inst)).padStart(7) +
      ("$" + b.d1_iap.toFixed(1)).padStart(9) +
      ("$" + b.d1_iaa.toFixed(1)).padStart(9) +
      ("$" + b.d1.toFixed(1)).padStart(10) +
      roas.padStart(9)
    );
  }
}

// baseline vs decline summary
function sumRange(country, start, end) {
  const ds = dates.filter(d => d >= start && d <= end);
  const agg = { cost: 0, inst: 0, d1_iap: 0, d1_iaa: 0, d1: 0, n: ds.length };
  for (const d of ds) {
    const b = byDateCountry[d + "|" + country];
    if (!b) continue;
    agg.cost += b.cost; agg.inst += b.inst; agg.d1_iap += b.d1_iap; agg.d1_iaa += b.d1_iaa; agg.d1 += b.d1;
  }
  return agg;
}

console.log("\n===== 기준(7/07~7/13) vs 하락(7/14~7/22) 일평균 비교 =====");
for (const country of ["JP", "KR"]) {
  const base = sumRange(country, "2026-07-07", "2026-07-13");
  const decl = sumRange(country, "2026-07-14", "2026-07-22");
  console.log(`\n■ ${country} (iOS)`);
  console.log(`  기준 : cost/일=$${(base.cost/base.n).toFixed(1)} IAP/일=$${(base.d1_iap/base.n).toFixed(1)} IAA/일=$${(base.d1_iaa/base.n).toFixed(1)} D1ROAS=${(base.d1/base.cost*100).toFixed(1)}%`);
  console.log(`  하락 : cost/일=$${(decl.cost/decl.n).toFixed(1)} IAP/일=$${(decl.d1_iap/decl.n).toFixed(1)} IAA/일=$${(decl.d1_iaa/decl.n).toFixed(1)} D1ROAS=${(decl.d1/decl.cost*100).toFixed(1)}%`);
  console.log(`  변화 : IAP ${(((decl.d1_iap/decl.n)/(base.d1_iap/base.n)-1)*100).toFixed(1)}% / IAA ${(((decl.d1_iaa/decl.n)/(base.d1_iaa/base.n)-1)*100).toFixed(1)}%`);
}
