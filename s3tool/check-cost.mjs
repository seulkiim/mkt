import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];

async function sampleTable(tbl, wantCols, maxFiles = 3) {
  const prefix = `${BASE}t=${tbl}/`;
  const dtResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, Delimiter: "/", MaxKeys: 20 }));
  const dates = (dtResp.CommonPrefixes||[]).map(p=>p.Prefix.replace(prefix,"").replace(/\/$/,"")).sort();
  if (!dates.length) { process.stdout.write(`[${tbl}] no dates\n`); return; }

  let fileCount = 0;
  const costRows = [];

  for (const dt of dates.slice(-3)) {
    const sub1Resp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}${dt}/`, Delimiter: "/", MaxKeys: 20 }));
    for (const sub1 of (sub1Resp.CommonPrefixes||[])) {
      const sub2Resp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: sub1.Prefix, Delimiter: "/", MaxKeys: 10 }));
      for (const sub2 of (sub2Resp.CommonPrefixes||[])) {
        // check if this is an app_id partition
        const appId = sub2.Prefix.match(/app_id=([^/]+)/)?.[1];
        if (appId && !APP_IDS.includes(appId)) continue;

        const fResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: sub2.Prefix, MaxKeys: 5 }));
        for (const f of (fResp.Contents||[]).filter(o=>o.Size>0&&o.Key.endsWith(".parquet"))) {
          if (fileCount >= maxFiles) break;
          fileCount++;
          const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: f.Key }));
          const chunks = []; for await (const c of resp.Body) chunks.push(c);
          const buf = Buffer.concat(chunks);
          const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength);
          const meta = parquetMetadata(ab);
          const allCols = meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);
          await parquetRead({ file: ab, onComplete: rows => {
            for (const row of rows) {
              const obj = {};
              for (const col of wantCols) {
                const idx = allCols.indexOf(col);
                obj[col] = idx >= 0 ? row[idx] : undefined;
              }
              // only keep rows with non-null cost
              const hasVal = wantCols.some(c => obj[c] != null && obj[c] !== '' && obj[c] !== 0);
              if (hasVal) costRows.push(obj);
            }
          }});
        }
        if (fileCount >= maxFiles) break;
      }
      if (fileCount >= maxFiles) break;
    }
  }
  process.stdout.write(`\n=== ${tbl} (${fileCount} files sampled) ===\n`);
  if (costRows.length === 0) {
    process.stdout.write(`  → 코스트 값 없음 (null/0 only)\n`);
  } else {
    costRows.slice(0,10).forEach(r => process.stdout.write(`  ${JSON.stringify(r)}\n`));
    process.stdout.write(`  ... total non-null rows: ${costRows.length}\n`);
  }
}

const COST_COLS = ["af_cost_model","af_cost_value","af_cost_currency","media_source","campaign"];

// Check tables that might have cost data
await sampleTable("installs", COST_COLS);
await sampleTable("clicks", COST_COLS);
await sampleTable("inapps", COST_COLS);
await sampleTable("creative_report", ["cost","impressions","clicks","installs","media_source","campaign","af_ad","af_adset","app_id"]);

process.stdout.write("\nDone\n");
