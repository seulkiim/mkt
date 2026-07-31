import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE   = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];
const TARGET_KST = ["2026-07-07","2026-07-08","2026-07-09","2026-07-10","2026-07-11","2026-07-12","2026-07-13"];
const TARGET_DTS = ["dt=2026-07-06","dt=2026-07-07","dt=2026-07-08","dt=2026-07-09","dt=2026-07-10","dt=2026-07-11","dt=2026-07-12","dt=2026-07-13","dt=2026-07-14"];
const MEDIA = ["applovin_int","Facebook Ads","liftoff_int","googleadwords_int"];

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

// A: 앱 필터 O (idolharvest만)  B: 앱 필터 X (전체 앱, 현재 스크립트 방식)
// flag=false만 카운트. media|date별.
const withApp = {};   // key -> count
const allApps = {};   // key -> count
const flagTrueApp = {}; // idolharvest, flag=true 카운트

for (const dt of TARGET_DTS) {
  const base = `${BASE}t=skad_installs/${dt}/`;
  const hFolders = (await listAll(base, "/")).prefixes; // h=0..
  for (const hf of hFolders) {
    // 전체 app_id 폴더
    const appFolders = (await listAll(hf, "/")).prefixes;
    for (const af of appFolders) {
      const appId = af.match(/app_id=([^/]+)/)?.[1];
      const isOurs = APP_IDS.includes(appId);
      const files = (await listAll(af)).files;
      for (const f of files) {
        const rows = await readParquet(f, ["install_date","media_source","af_attribution_flag"]);
        for (const r of rows) {
          const kd = r.install_date ? String(r.install_date).slice(0,10) : null;
          if (!kd || !TARGET_KST.includes(kd)) continue;
          const media = r.media_source || "unknown";
          const flag = String(r.af_attribution_flag).toLowerCase();
          const key = `${media}|${kd}`;
          // 전체 앱, flag=false
          if (flag !== "true") allApps[key] = (allApps[key]||0)+1;
          // 우리 앱만
          if (isOurs) {
            if (flag !== "true") withApp[key] = (withApp[key]||0)+1;
            else flagTrueApp[key] = (flagTrueApp[key]||0)+1;
          }
        }
      }
    }
  }
  process.stderr.write(`${dt} done\n`);
}

process.stdout.write("\n═══ skad installs (flag=false) 비교: [우리앱만] vs [전체앱=현재방식] ═══\n\n");
for (const media of MEDIA) {
  process.stdout.write(`■ ${media}\n`);
  process.stdout.write(`   ${"날짜".padEnd(12)}${"우리앱".padStart(8)}${"전체앱".padStart(8)}${"(flag=true제외수,우리앱)".padStart(24)}\n`);
  for (const d of TARGET_KST) {
    const k = `${media}|${d}`;
    const a = withApp[k]||0, b = allApps[k]||0, t = flagTrueApp[k]||0;
    if (a||b||t) process.stdout.write(`   ${d.padEnd(12)}${String(a).padStart(8)}${String(b).padStart(8)}${String(t).padStart(24)}\n`);
  }
  process.stdout.write("\n");
}
process.stdout.write("Done.\n");
