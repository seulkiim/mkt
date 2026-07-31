import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata } from "hyparquet";

const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";

for (const tbl of ["attributed_ad_revenue_v2","organic_ad_revenue_v2","retargeting_ad_revenue_v2"]) {
  const prefix = `${BASE}t=${tbl}/`;
  const dtResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, Delimiter: "/", MaxKeys: 20 }));
  const dates = (dtResp.CommonPrefixes||[]).map(p=>p.Prefix.replace(prefix,"").replace(/\/$/,"")).sort();
  process.stdout.write(`\n=== ${tbl} ===\ndates: ${dates.join(", ")}\n`);

  if (dates.length === 0) continue;
  const dt = dates.at(-1);
  const hResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}${dt}/`, Delimiter: "/", MaxKeys: 10 }));
  const hours = (hResp.CommonPrefixes||[]).map(p=>p.Prefix.replace(`${prefix}${dt}/`,"").replace(/\/$/,"")).sort();

  let found = false;
  for (const h of hours.slice(0,5)) {
    if (found) break;
    const appResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}${dt}/${h}/`, Delimiter: "/", MaxKeys: 5 }));
    for (const ap of (appResp.CommonPrefixes||[])) {
      const fResp = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: ap.Prefix, MaxKeys: 3 }));
      const f = (fResp.Contents||[]).find(o=>o.Size>0 && o.Key.endsWith(".parquet"));
      if (f) {
        const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: f.Key }));
        const chunks = []; for await (const c of resp.Body) chunks.push(c);
        const buf = Buffer.concat(chunks);
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength);
        const meta = parquetMetadata(ab);
        const cols = meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);
        process.stdout.write(`sample: ${f.Key}\ncolumns (${cols.length}): ${cols.join(", ")}\n`);
        found = true;
        break;
      }
    }
  }
  if (!found) process.stdout.write("no parquet files found\n");
}
