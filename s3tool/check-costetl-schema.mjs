import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";

async function sampleTable(tbl) {
  const prefix = `${BASE}t=${tbl}/`;
  const dtR = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, Delimiter: "/", MaxKeys: 20 }));
  const dates = (dtR.CommonPrefixes||[]).map(p=>p.Prefix.replace(prefix,"").replace(/\/$/,"")).sort();
  process.stdout.write(`\n=== ${tbl} | dates: ${dates.join(", ")} ===\n`);

  const dt = dates.at(-1);
  if (!dt) return;
  const s1 = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}${dt}/`, Delimiter: "/", MaxKeys: 10 }));
  for (const p1 of (s1.CommonPrefixes||[])) {
    const fR = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: p1.Prefix, MaxKeys: 5 }));
    const f = (fR.Contents||[]).find(o=>o.Size>0&&o.Key.endsWith(".parquet"));
    if (!f) continue;
    const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: f.Key }));
    const chunks=[]; for await (const c of resp.Body) chunks.push(c);
    const buf=Buffer.concat(chunks);
    const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
    const meta=parquetMetadata(ab);
    const cols=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);
    process.stdout.write(`cols(${cols.length}): ${cols.join(", ")}\n`);
    await parquetRead({ file: ab, onComplete: rows => {
      rows.slice(0,5).forEach(row => {
        const obj={};
        cols.forEach((c,i)=>{ if(row[i]!=null&&row[i]!=="") obj[c]=row[i]; });
        process.stdout.write(`  ${JSON.stringify(obj).slice(0,400)}\n`);
      });
    }});
    return;
  }
}

for (const tbl of ["cost_etl_summary","cost_etl_channel","cost_etl_geo","cost_etl_all_cost_geo"]) {
  await sampleTable(tbl);
}
