import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE   = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];

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
async function readParquet(key, wantCols) {
  const resp = await client.send(new GetObjectCommand({Bucket:BUCKET,Key:key}));
  const chunks=[]; for await (const c of resp.Body) chunks.push(c);
  const buf=Buffer.concat(chunks);
  const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
  const meta=parquetMetadata(ab);
  const allCols=meta.schema.filter(s=>s.name&&s.name!=="spark_schema").map(s=>s.name);
  const rows=[];
  await parquetRead({file:ab, onComplete: rawRows => {
    for (const row of rawRows) { const obj={}; wantCols.forEach(c=>{const i=allCols.indexOf(c);obj[c]=i>=0?row[i]:null;}); rows.push(obj); }
  }});
  return rows;
}

// applovin install_date=2026-07-09, flag=false 를 각 dt= 파티션에서 카운트
// → dt= 간 중복(누적 재작성) 여부 판단
const base = `${BASE}t=skad_installs/`;
const dts = (await listAll(base,"/")).prefixes.map(p=>p.replace(base,"").replace(/\/$/,"")).sort();

process.stdout.write("═══ applovin_int, install_date=2026-07-09, flag=false 를 각 dt= 에서 ═══\n");
for (const dt of dts) {
  let cnt=0;
  const hFolders = (await listAll(`${base}${dt}/`,"/")).prefixes;
  for (const hf of hFolders) {
    for (const appId of APP_IDS) {
      const files = (await listAll(`${hf}app_id=${appId}/`)).files;
      for (const f of files) {
        const rows = await readParquet(f, ["install_date","media_source","af_attribution_flag"]);
        for (const r of rows) {
          if (r.media_source!=="applovin_int") continue;
          if (String(r.install_date).slice(0,10)!=="2026-07-09") continue;
          if (String(r.af_attribution_flag).toLowerCase()==="true") continue;
          cnt++;
        }
      }
    }
  }
  process.stdout.write(`  ${dt}: ${cnt}건\n`);
}

process.stdout.write("\n→ 특정 dt=에만 몰려있으면 중복 없음(합산 OK). 여러 dt=에 분산+반복이면 누적 스냅샷\n");
process.stdout.write("Done.\n");
