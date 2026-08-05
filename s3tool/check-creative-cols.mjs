import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata } from "hyparquet";

const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const TABLES = ["cost_etl_geo","installs","inapps","attributed_ad_revenue_v2","organic_ad_revenue_v2","retargeting_ad_revenue_v2","skad_installs","skad_inapps","cohort_unified","cost_etl_summary"];

async function listPrefixes(prefix){const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:prefix,Delimiter:"/",MaxKeys:1000}));return (r.CommonPrefixes||[]).map(p=>p.Prefix);}
async function listParquet(prefix){const files=[];let token;do{const r=await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:prefix,MaxKeys:1000,ContinuationToken:token}));for(const o of (r.Contents||[]))if(o.Size>0&&o.Key.endsWith(".parquet"))files.push(o.Key);token=r.NextContinuationToken;}while(token);return files;}

for (const tbl of TABLES) {
  const base = `${BASE}t=${tbl}/`;
  let dts;
  try { dts = (await listPrefixes(base)).map(p=>p.replace(base,"").replace(/\/$/,"")).sort(); }
  catch(e){ console.log(`${tbl}: ERROR listing - ${e.message}`); continue; }
  if (!dts.length) { console.log(`${tbl}: no dt partitions`); continue; }
  const latest = dts.at(-1);
  // find a sample parquet file under latest dt (handle version=/dt= or dt=/h=/app_id= variants)
  let sampleKey = null;
  async function findSample(prefix, depth) {
    if (sampleKey || depth > 4) return;
    const files = await client.send(new ListObjectsV2Command({Bucket:BUCKET,Prefix:prefix,MaxKeys:20}));
    const f = (files.Contents||[]).find(o=>o.Size>0&&o.Key.endsWith(".parquet"));
    if (f) { sampleKey = f.Key; return; }
    const subs = await listPrefixes(prefix);
    for (const s of subs) { await findSample(s, depth+1); if (sampleKey) return; }
  }
  await findSample(`${base}${latest}/`, 0);
  if (!sampleKey) { console.log(`${tbl} (dt=${latest}): no parquet file found`); continue; }
  const resp = await client.send(new GetObjectCommand({Bucket:BUCKET,Key:sampleKey}));
  const chunks=[]; for await (const c of resp.Body) chunks.push(c);
  const buf = Buffer.concat(chunks);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength);
  const meta = parquetMetadata(ab);
  const cols = meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);
  const creativeCols = cols.filter(c=>/ad|creative/i.test(c));
  console.log(`${tbl} (dt=${latest}): ${cols.length} cols`);
  console.log(`  creative-ish: ${creativeCols.join(", ") || "(none)"}`);
}
