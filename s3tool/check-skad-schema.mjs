import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];

async function sampleTable(tbl) {
  const prefix = `${BASE}t=${tbl}/`;
  const dtR = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, Delimiter: "/", MaxKeys: 30 }));
  const dates = (dtR.CommonPrefixes||[]).map(p=>p.Prefix.replace(prefix,"").replace(/\/$/,"")).sort();
  process.stdout.write(`\n=== ${tbl} ===\ndates: ${dates.join(", ") || "없음"}\n`);
  if (!dates.length) return;

  // find a sample file
  for (const dt of dates.slice(-3)) {
    const s1 = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}${dt}/`, Delimiter: "/", MaxKeys: 20 }));
    for (const p1 of (s1.CommonPrefixes||[])) {
      const s2 = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: p1.Prefix, Delimiter: "/", MaxKeys: 10 }));
      for (const p2 of (s2.CommonPrefixes||[])) {
        const appId = p2.Prefix.match(/app_id=([^/]+)/)?.[1];
        const skip = appId && !APP_IDS.includes(appId);
        const fR = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: p2.Prefix, MaxKeys: 3 }));
        const f = (fR.Contents||[]).find(o=>o.Size>0&&o.Key.endsWith(".parquet"));
        if (!f) continue;
        const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: f.Key }));
        const chunks=[]; for await (const c of resp.Body) chunks.push(c);
        const buf=Buffer.concat(chunks);
        const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
        const meta=parquetMetadata(ab);
        const cols=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);
        process.stdout.write(`sample: ${f.Key.split("/").slice(-3).join("/")} (app: ${appId||"any"}, skip: ${skip})\n`);
        process.stdout.write(`cols(${cols.length}): ${cols.join(", ")}\n`);
        // show 2 sample rows
        await parquetRead({ file: ab, onComplete: rows => {
          rows.slice(0,2).forEach(row => {
            const obj={};
            cols.forEach((c,i)=>{ if(row[i]!=null) obj[c]=row[i]; });
            process.stdout.write(`  row: ${JSON.stringify(obj).slice(0,300)}\n`);
          });
        }});
        return;
      }
    }
  }
}

for (const tbl of ["skad_installs","skad_inapps","skad_postbacks","cost_etl_summary","cost_etl_channel","cost_etl_geo","cost_etl_all_cost_geo"]) {
  await sampleTable(tbl);
}
