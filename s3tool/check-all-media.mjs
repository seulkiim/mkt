import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];

const mediaCount = {}; // "table|media_source" -> count

for (const tbl of ["installs", "clicks", "inapps"]) {
  const prefix = `${BASE}t=${tbl}/`;
  const dtR = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, Delimiter: "/", MaxKeys: 50 }));
  const dates = (dtR.CommonPrefixes || []).map(p => p.Prefix.replace(prefix, "").replace(/\/$/, "")).sort();
  process.stderr.write(`${tbl}: ${dates.length} dates\n`);

  for (const dt of dates) {
    const h1 = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}${dt}/`, Delimiter: "/", MaxKeys: 50 }));
    for (const s1 of (h1.CommonPrefixes || [])) {
      const h2 = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: s1.Prefix, Delimiter: "/", MaxKeys: 10 }));
      for (const s2 of (h2.CommonPrefixes || [])) {
        const appId = s2.Prefix.match(/app_id=([^/]+)/)?.[1];
        if (!APP_IDS.includes(appId)) continue;
        const fR = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: s2.Prefix, MaxKeys: 5 }));
        const files = (fR.Contents || []).filter(o => o.Size > 0 && o.Key.endsWith(".parquet"));
        if (!files.length) continue;

        // read first file only for media source sampling
        const f = files[0];
        const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: f.Key }));
        const chunks = []; for await (const c of resp.Body) chunks.push(c);
        const buf = Buffer.concat(chunks);
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        const meta = parquetMetadata(ab);
        const allCols = meta.schema.filter(s => s.name && s.name !== "spark_schema").map(s => s.name);
        const msIdx = allCols.indexOf("media_source");
        if (msIdx < 0) continue;

        await parquetRead({ file: ab, onComplete: rows => {
          for (const row of rows) {
            const m = row[msIdx] || "organic";
            const k = `${tbl}|${m}`;
            mediaCount[k] = (mediaCount[k] || 0) + 1;
          }
        }});
      }
    }
    process.stderr.write(`  ${dt} done\n`);
  }
}

const applovin = Object.entries(mediaCount).filter(([k]) => k.toLowerCase().includes("applovin"));
process.stdout.write("\n=== Applovin 관련 ===\n");
if (applovin.length) applovin.forEach(([k, v]) => process.stdout.write(`  ${k}: ${v}건\n`));
else process.stdout.write("  없음\n");

process.stdout.write("\n=== 전체 media_source 목록 ===\n");
Object.entries(mediaCount)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => process.stdout.write(`  ${k}: ${v}건\n`));
