import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];

const prefix = `${BASE}t=creative_report/`;
const dtResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, Delimiter: "/", MaxKeys: 50 }));
const dates = (dtResp.CommonPrefixes||[]).map(p=>p.Prefix.replace(prefix,"").replace(/\/$/,"")).sort();
process.stderr.write(`dates: ${dates.join(", ")}\n`);

const COLS = ["cost","impressions","clicks","installs","media_source","campaign","af_adset","af_ad","af_ad_type","country_code","platform","app_id","date"];

// By date → media → campaign → {cost, impressions, clicks, installs}
const summary = {}; // date -> {total_cost, by_media}

for (const dt of dates) {
  const hResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}${dt}/`, Delimiter: "/", MaxKeys: 20 }));
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
            const obj = {};
            for (const col of COLS) {
              const idx = allCols.indexOf(col);
              obj[col] = idx>=0 ? row[idx] : null;
            }
            const cost = parseFloat(obj.cost)||0;
            const impr = parseFloat(obj.impressions)||0;
            const clks = parseFloat(obj.clicks)||0;
            const inst = parseFloat(obj.installs)||0;
            const media = obj.media_source || 'unknown';
            const camp  = obj.campaign || 'unknown';
            const cntry = obj.country_code || 'XX';
            const plat  = appId === 'id6756664337' ? 'ios' : 'android';

            if (!summary[dt]) summary[dt] = { total_cost:0, total_impr:0, total_clks:0, total_inst:0, by_media:{} };
            summary[dt].total_cost += cost;
            summary[dt].total_impr += impr;
            summary[dt].total_clks += clks;
            summary[dt].total_inst += inst;

            const mk = `${media}|||${camp}|||${plat}`;
            if (!summary[dt].by_media[mk]) summary[dt].by_media[mk] = { media, campaign:camp, platform:plat, cost:0, impressions:0, clicks:0, installs:0, countries:new Set() };
            summary[dt].by_media[mk].cost += cost;
            summary[dt].by_media[mk].impressions += impr;
            summary[dt].by_media[mk].clicks += clks;
            summary[dt].by_media[mk].installs += inst;
            summary[dt].by_media[mk].countries.add(cntry);
          }
        }});
      }
    }
  }
  process.stderr.write(`done: ${dt}\n`);
}

// Output
process.stdout.write("=== Creative Report Cost Summary ===\n\n");
let grandTotal = 0;
for (const dt of dates) {
  const s = summary[dt];
  if (!s) continue;
  grandTotal += s.total_cost;
  process.stdout.write(`── ${dt} ──\n`);
  process.stdout.write(`  Total Cost: $${s.total_cost.toFixed(2)}  |  Impressions: ${s.total_impr.toFixed(0)}  |  Clicks: ${s.total_clks.toFixed(0)}  |  Installs: ${s.total_inst.toFixed(0)}\n`);
  const entries = Object.values(s.by_media).filter(e=>e.cost>0||e.impressions>0).sort((a,b)=>b.cost-a.cost);
  for (const e of entries) {
    process.stdout.write(`  [${e.platform}] ${e.media} | ${e.campaign}\n`);
    process.stdout.write(`    Cost: $${e.cost.toFixed(2)} | Impr: ${e.impressions.toFixed(0)} | Clicks: ${e.clicks.toFixed(0)} | Installs: ${e.installs.toFixed(0)} | Countries: ${[...e.countries].join(',')}\n`);
  }
  process.stdout.write("\n");
}
process.stdout.write(`Grand Total Cost: $${grandTotal.toFixed(2)}\n`);
