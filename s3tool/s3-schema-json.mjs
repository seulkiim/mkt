import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata } from "hyparquet";
import { writeFileSync } from "fs";
import { dataPath } from "./paths.mjs";

const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";

const topResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: BASE, Delimiter: "/" }));
const tables = (topResp.CommonPrefixes || []).map(p => ({
  name: p.Prefix.replace(BASE, "").replace(/\/$/, ""),
  prefix: p.Prefix
}));

const result = [];

for (const tbl of tables) {
  process.stderr.write(`scanning: ${tbl.name}\n`);
  const dtResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: tbl.prefix, Delimiter: "/", MaxKeys: 100 }));
  const dates = (dtResp.CommonPrefixes || []).map(p => p.Prefix.replace(tbl.prefix, "").replace(/\/$/, "")).sort();

  let sampleFile = null;
  const appIds = new Set();
  let hours = [];

  if (dates.length > 0) {
    const latestDt = dates.at(-1);
    const hResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${tbl.prefix}${latestDt}/`, Delimiter: "/", MaxKeys: 100 }));
    hours = (hResp.CommonPrefixes || []).map(p => p.Prefix.replace(`${tbl.prefix}${latestDt}/`, "").replace(/\/$/, "")).sort();

    outer: for (const h of hours.slice(0, 6)) {
      const appResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${tbl.prefix}${latestDt}/${h}/`, Delimiter: "/", MaxKeys: 20 }));
      for (const ap of (appResp.CommonPrefixes || [])) {
        const apId = ap.Prefix.replace(`${tbl.prefix}${latestDt}/${h}/`, "").replace(/\/$/, "").replace("app_id=", "");
        appIds.add(apId);
        const fResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: ap.Prefix, MaxKeys: 5 }));
        const f = (fResp.Contents || []).find(o => o.Size > 0 && o.Key.endsWith(".parquet"));
        if (f) { sampleFile = { key: f.Key, size: f.Size }; break outer; }
      }
    }
  }

  let cols = [];
  if (sampleFile) {
    try {
      const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: sampleFile.key }));
      const chunks = [];
      for await (const c of resp.Body) chunks.push(c);
      const buf = Buffer.concat(chunks);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const meta = parquetMetadata(ab);
      cols = meta.schema.filter(s => s.name && s.name !== "spark_schema").map(s => s.name);
    } catch (e) {
      cols = [`[error: ${e.message.slice(0, 60)}]`];
    }
  }

  result.push({
    table: tbl.name.replace("t=", ""),
    date_range: dates.length ? `${dates[0]} ~ ${dates.at(-1)}` : null,
    date_count: dates.length,
    hours_per_day: hours.length,
    app_ids: [...appIds],
    col_count: cols.length,
    columns: cols
  });
}

writeFileSync(dataPath("schema-result.json"), JSON.stringify(result, null, 2), "utf8");
process.stderr.write(`\nDone: ${result.length} tables\n`);
console.log(JSON.stringify(result));
