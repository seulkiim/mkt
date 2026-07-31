import { GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET as bucket } from "./aws-client.mjs";
import { parquetRead, parquetMetadata } from "hyparquet";


const key = "c7yL-acc-m4k6c7yL-c7yL/wemadeplay/t=inapps/dt=2026-06-30/h=10/app_id=com.albus.idolharvest/part-00000-daf2b359-8ee3-4d6d-809f-e8cb59d225b1.c000.snappy.parquet";

const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
const chunks = [];
for await (const chunk of resp.Body) chunks.push(chunk);
const buffer = Buffer.concat(chunks);

const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

// 메타데이터에서 컬럼 확인
const meta = parquetMetadata(ab);
console.log("=== 컬럼 목록 ===");
meta.schema.forEach(s => { if (s.name) console.log(s.name); });

// 첫 5행 출력
console.log("\n=== 첫 5행 데이터 ===");
let count = 0;
await parquetRead({
  file: ab,
  onComplete: (rows) => {
    rows.slice(0, 5).forEach(row => {
      console.log(JSON.stringify(row));
      count++;
    });
    // 이벤트명 종류 확인
    const eventNames = [...new Set(rows.map(r => r.event_name || r.eventName || r.event_type || "N/A"))];
    console.log(`\n=== 이벤트명 종류 (총 ${rows.length}행) ===`);
    console.log(eventNames.slice(0, 20).join(", "));
  }
});
