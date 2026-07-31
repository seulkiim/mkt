import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET } from "./aws-client.mjs";
import { parquetMetadata, parquetRead } from "hyparquet";

const BASE = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/";
const APP_IDS = ["com.albus.idolharvest", "id6756664337"];

// 7/1 KST ~ = dt=2026-07-01 이후 (UTC 기준, 7/1 KST 0:00 = 6/30 15:00 UTC이므로 dt=2026-06-30도 포함)
const TARGET_DTS = [
  "dt=2026-06-30", "dt=2026-07-01", "dt=2026-07-02", "dt=2026-07-03",
  "dt=2026-07-04", "dt=2026-07-05", "dt=2026-07-06", "dt=2026-07-07"
];

const KST_START = new Date("2026-07-01T00:00:00+09:00");

// media -> { table -> count }
const mediaMap = {};

for (const tbl of ["installs", "clicks", "inapps"]) {
  const prefix = `${BASE}t=${tbl}/`;

  for (const dt of TARGET_DTS) {
    const h1 = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${prefix}${dt}/`, Delimiter: "/", MaxKeys: 50 }));
    if (!h1.CommonPrefixes?.length) continue;

    for (const s1 of (h1.CommonPrefixes || [])) {
      const h2 = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: s1.Prefix, Delimiter: "/", MaxKeys: 10 }));
      for (const s2 of (h2.CommonPrefixes || [])) {
        const appId = s2.Prefix.match(/app_id=([^/]+)/)?.[1];
        if (!APP_IDS.includes(appId)) continue;

        const fR = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: s2.Prefix, MaxKeys: 20 }));
        const files = (fR.Contents || []).filter(o => o.Size > 0 && o.Key.endsWith(".parquet"));

        for (const f of files) {
          const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: f.Key }));
          const chunks = []; for await (const c of resp.Body) chunks.push(c);
          const buf = Buffer.concat(chunks);
          const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          const meta = parquetMetadata(ab);
          const allCols = meta.schema.filter(s => s.name && s.name !== "spark_schema").map(s => s.name);
          const msIdx = allCols.indexOf("media_source");
          const tsCol = tbl === "installs" ? "install_time" : tbl === "clicks" ? "click_time" : "event_time";
          const tsIdx = allCols.indexOf(tsCol);
          if (msIdx < 0) continue;

          await parquetRead({ file: ab, onComplete: rows => {
            for (const row of rows) {
              const ts = tsIdx >= 0 ? row[tsIdx] : null;
              if (ts) {
                const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
                if (d < KST_START) continue;
              }
              const m = row[msIdx] || "organic";
              if (!mediaMap[m]) mediaMap[m] = { installs: 0, clicks: 0, inapps: 0 };
              mediaMap[m][tbl === "inapps" ? "inapps" : tbl]++;
            }
          }});
        }
      }
    }
    process.stderr.write(`${tbl}/${dt} done\n`);
  }
}

process.stdout.write("\n=== 7/1 KST 이후 집계된 전체 media_source ===\n\n");
const sorted = Object.entries(mediaMap).sort((a, b) => {
  const ta = a[1].installs + a[1].clicks + a[1].inapps;
  const tb = b[1].installs + b[1].clicks + b[1].inapps;
  return tb - ta;
});

sorted.forEach(([m, v]) => {
  const parts = [];
  if (v.installs) parts.push(`설치 ${v.installs}건`);
  if (v.clicks)   parts.push(`클릭 ${v.clicks}건`);
  if (v.inapps)   parts.push(`인앱 ${v.inapps}건`);
  process.stdout.write(`  ${m}: ${parts.join(" / ")}\n`);
});

process.stdout.write(`\n총 ${sorted.length}개 매체\n`);
