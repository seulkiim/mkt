import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE   = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";

async function run() {
  const prefix = `${BASE}t=installs/dt=2026-07-07/`;
  const s1 = await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:prefix,Delimiter:"/",MaxKeys:10}));

  for (const p1 of (s1.CommonPrefixes||[])) {
    const s2 = await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p1.Prefix,Delimiter:"/",MaxKeys:5}));
    for (const p2 of (s2.CommonPrefixes||[])) {
      const fR = await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:p2.Prefix,MaxKeys:3}));
      const f = (fR.Contents||[]).find(o=>o.Size>0&&o.Key.endsWith(".parquet"));
      if (!f) continue;

      const resp = await client.send(new GetObjectCommand({Bucket:BUCKET,Key:f.Key}));
      const chunks=[]; for await (const c of resp.Body) chunks.push(c);
      const buf=Buffer.concat(chunks);
      const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
      const meta=parquetMetadata(ab);
      const allCols=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);

      process.stdout.write(`\n파일: ${f.Key.split("/").slice(-4).join("/")}\n`);
      process.stdout.write(`컬럼(${allCols.length}): ${allCols.join(", ")}\n\n`);

      await parquetRead({file:ab, onComplete: rows => {
        rows.slice(0,5).forEach((row,i) => {
          const obj={};
          allCols.forEach((c,ci)=>{ if(row[ci]!=null) obj[c]=row[ci]; });
          const it = obj.install_time;
          process.stdout.write(`행${i+1}: app_id=${JSON.stringify(obj.app_id)} media=${JSON.stringify(obj.media_source)} install_time=${JSON.stringify(it)} (type:${typeof it})\n`);
        });
      }});
      return;
    }
  }
}
await run();
