import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE   = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";

async function listAll(prefix, delimiter) {
  const opts = { Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000 };
  if (delimiter) opts.Delimiter = delimiter;
  const out = { prefixes: [], files: [] };
  let token;
  do {
    const r = await client.send(new ListObjectsV2Command({ ...opts, ContinuationToken: token }));
    for (const p of (r.CommonPrefixes||[])) out.prefixes.push(p.Prefix);
    for (const o of (r.Contents||[])) if (o.Size>0&&o.Key.endsWith(".parquet")) out.files.push(o.Key);
    token = r.NextContinuationToken;
  } while(token);
  return out;
}
async function firstFileUnder(prefix) {
  // recurse into CommonPrefixes to find first parquet
  let cur = prefix;
  for (let i=0;i<6;i++){
    const r = await listAll(cur, "/");
    if (r.files.length) return r.files[0];
    if (!r.prefixes.length) return null;
    cur = r.prefixes[0];
  }
  const r = await listAll(cur);
  return r.files[0]||null;
}
async function cols(key) {
  const resp = await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));
  const chunks=[]; for await (const c of resp.Body) chunks.push(c);
  const buf=Buffer.concat(chunks);
  const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
  const meta=parquetMetadata(ab);
  return meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);
}

for (const tbl of ["inapps","attributed_ad_revenue_v2","organic_ad_revenue_v2","cost_etl_summary"]) {
  const base = `${BASE}t=${tbl}/`;
  const dtR = await listAll(base, "/");
  const lastDt = dtR.prefixes.map(p=>p.replace(base,"").replace(/\/$/,"")).sort().at(-1);
  const f = await firstFileUnder(`${base}${lastDt}/`);
  if (!f) { process.stdout.write(`${tbl}: no file\n`); continue; }
  const c = await cols(f);
  const rel = c.filter(x => /country|geo|region|install_time|event_time|install_date|media_source|revenue_usd|event_name/i.test(x));
  process.stdout.write(`\n${tbl}:\n  ${rel.join(", ")}\n`);
}
process.stdout.write("\nDone.\n");
