import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET as bucket } from "./aws-client.mjs";
import { parquetRead } from "hyparquet";


const APP_IDS = ["com.albus.idolharvest", "id6756664337"];

// KST 7/1 00:00 ~ 7/5 23:59 → UTC 6/30 15:00 ~ 7/5 14:59
const KST_START = new Date("2026-07-01T00:00:00+09:00");
const KST_END   = new Date("2026-07-05T23:59:59+09:00");

const COLS = [
  "attributed_touch_type","attributed_touch_time","install_time","event_time","event_name",
  "event_value","event_revenue","event_revenue_currency","event_revenue_usd","af_cost_model",
  "af_cost_value","af_cost_currency","event_source","is_receipt_validated","af_prt",
  "media_source","af_channel","af_keywords","install_app_store","campaign",
  "af_c_id","af_adset","af_adset_id","af_ad","af_ad_id","af_ad_type","af_siteid",
  "af_sub_siteid","af_sub1","af_sub2","af_sub3","af_sub4","af_sub5",
  "region","country_code","state","city","postal_code","dma","ip","wifi",
  "operator","carrier","language","appsflyer_id","customer_user_id","android_id",
  "advertising_id","imei","idfa","idfv","amazon_aid","device_type","device_category",
  "platform","os_version","app_version","sdk_version","app_name","bundle_id",
  "is_retargeting","is_primary_attribution"
];

const IDX = (name) => COLS.indexOf(name);
const EVENT_NAME_IDX    = IDX("event_name");
const EVENT_TIME_IDX    = IDX("event_time");
const EVENT_VALUE_IDX   = IDX("event_value");
const EVENT_REV_USD_IDX = IDX("event_revenue_usd");
const COUNTRY_IDX       = IDX("country_code");
const PLATFORM_IDX      = IDX("platform");
const MEDIA_IDX         = IDX("media_source");
const BUNDLE_IDX        = IDX("bundle_id");
const CHANNEL_IDX       = IDX("af_channel");

async function readS3File(key) {
  const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  const buf = Buffer.concat(chunks);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function getFiles() {
  const files = [];
  // 6/30 ~ 7/5 날짜 범위 (UTC 기준)
  const dates = ["2026-06-30","2026-07-01","2026-07-02","2026-07-03","2026-07-04","2026-07-05"];
  for (const appId of APP_IDS) {
    for (const dt of dates) {
      const prefix = `c7yL-acc-m4k6c7yL-c7yL/wemadeplay/t=inapps/dt=${dt}/`;
      let ct = undefined;
      do {
        const resp = await client.send(new ListObjectsV2Command({
          Bucket: bucket, Prefix: prefix, MaxKeys: 200, ContinuationToken: ct
        }));
        (resp.Contents || [])
          .filter(o => o.Key.includes(`app_id=${appId}`) && o.Size > 0)
          .forEach(o => files.push({ key: o.Key, appId, dt }));
        ct = resp.NextContinuationToken;
      } while (ct);
    }
  }
  return files;
}

console.log("파일 목록 조회 중...");
const files = await getFiles();
console.log(`총 ${files.length}개 파일 발견\n`);

const purchases = [];
let fi = 0;

for (const f of files) {
  fi++;
  process.stderr.write(`\r처리 중: ${fi}/${files.length} (${f.dt} / ${f.appId})`);
  try {
    const ab = await readS3File(f.key);
    await parquetRead({
      file: ab,
      onComplete: (rows) => {
        rows.forEach(row => {
          if (row[EVENT_NAME_IDX] !== "af_purchase") return;

          // KST 필터
          const evtUtc = new Date(row[EVENT_TIME_IDX] + "Z");
          if (evtUtc < KST_START || evtUtc > KST_END) return;

          // event_value 파싱
          let ev = {};
          try { ev = JSON.parse(row[EVENT_VALUE_IDX] || "{}"); } catch(e) {}

          // KST 날짜 추출
          const kstDate = new Date(evtUtc.getTime() + 9 * 3600 * 1000)
            .toISOString().substring(0, 10);

          purchases.push({
            kst_date:     kstDate,
            country:      row[COUNTRY_IDX] || "Unknown",
            platform:     row[PLATFORM_IDX] || "Unknown",
            bundle_id:    row[BUNDLE_IDX] || f.appId,
            media_source: row[MEDIA_IDX] || "organic",
            channel:      row[CHANNEL_IDX] || "",
            revenue_usd:  parseFloat(row[EVENT_REV_USD_IDX]) || parseFloat(ev.af_revenue) || 0,
            product_id:   ev.af_content_id || ev.product_id || null,
            product_name: ev.af_content || ev.product_name || null,
            currency:     ev.af_currency || "USD",
          });
        });
      }
    });
  } catch(e) {}
}

console.log(`\n\n✅ 총 af_purchase: ${purchases.length}건\n`);

if (purchases.length === 0) {
  console.log("해당 기간 구매 데이터가 없습니다.");
  process.exit(0);
}

// ── 분석 1: 날짜별 ──
const byDate = {};
purchases.forEach(p => {
  if (!byDate[p.kst_date]) byDate[p.kst_date] = { count: 0, revenue: 0 };
  byDate[p.kst_date].count++;
  byDate[p.kst_date].revenue += p.revenue_usd;
});
console.log("=== [날짜별] ===");
console.log("날짜,구매건수,매출(USD)");
Object.keys(byDate).sort().forEach(d =>
  console.log(`${d},${byDate[d].count},$${byDate[d].revenue.toFixed(2)}`)
);

// ── 분석 2: 국가 × 미디어소스 ──
const byCountryMedia = {};
purchases.forEach(p => {
  const key = `${p.country}|${p.media_source}`;
  if (!byCountryMedia[key]) byCountryMedia[key] = { count: 0, revenue: 0 };
  byCountryMedia[key].count++;
  byCountryMedia[key].revenue += p.revenue_usd;
});
console.log("\n=== [국가 × 미디어소스별] ===");
console.log("국가,미디어소스,구매건수,매출(USD)");
Object.entries(byCountryMedia)
  .sort((a, b) => b[1].count - a[1].count)
  .forEach(([k, v]) => {
    const [country, media] = k.split("|");
    console.log(`${country},${media},${v.count},$${v.revenue.toFixed(2)}`);
  });

// ── 분석 3: 구매 상품별 ──
const byProduct = {};
purchases.forEach(p => {
  const key = p.product_id || p.product_name || "알 수 없음";
  if (!byProduct[key]) byProduct[key] = { count: 0, revenue: 0, countries: new Set(), medias: new Set() };
  byProduct[key].count++;
  byProduct[key].revenue += p.revenue_usd;
  byProduct[key].countries.add(p.country);
  byProduct[key].medias.add(p.media_source);
});
console.log("\n=== [구매 상품별] ===");
console.log("상품ID,구매건수,매출(USD),구매국가,미디어소스");
Object.entries(byProduct)
  .sort((a, b) => b[1].count - a[1].count)
  .forEach(([prod, v]) => {
    console.log(`${prod},${v.count},$${v.revenue.toFixed(2)},[${[...v.countries].join("/")}],[${[...v.medias].join("/")}]`);
  });

// ── 분석 4: OS × 국가 ──
const byOSCountry = {};
purchases.forEach(p => {
  const key = `${p.platform}|${p.country}`;
  if (!byOSCountry[key]) byOSCountry[key] = { count: 0, revenue: 0 };
  byOSCountry[key].count++;
  byOSCountry[key].revenue += p.revenue_usd;
});
console.log("\n=== [OS × 국가별] ===");
console.log("OS,국가,구매건수,매출(USD)");
Object.entries(byOSCountry)
  .sort((a, b) => b[1].count - a[1].count)
  .forEach(([k, v]) => {
    const [os, country] = k.split("|");
    console.log(`${os},${country},${v.count},$${v.revenue.toFixed(2)}`);
  });

// ── 전체 합계 ──
const totalRev = purchases.reduce((s, p) => s + p.revenue_usd, 0);
console.log(`\n=== [전체 합계] ===`);
console.log(`총 구매 건수: ${purchases.length}건`);
console.log(`총 매출: $${totalRev.toFixed(2)}`);
