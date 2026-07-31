import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { client, BUCKET as bucket } from "./aws-client.mjs";
import { parquetRead, parquetMetadata } from "hyparquet";


const APP_IDS = ["com.albus.idolharvest", "id6756664337"];

// 컬럼 인덱스 매핑
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
  "is_retargeting","is_primary_attribution","af_attribution_lookback","match_type",
  "user_agent","http_referrer","original_url","gp_referrer","gp_click_time",
  "gp_install_begin","gp_broadcast_referrer","custom_data","network_account_id",
  "keyword_match_type","af_web_id","device_download_time","deeplink_url","oaid",
  "conversion_type","campaign_type","device_model","att","custom_dimension","is_lat",
  "app_type","keyword_id","is_organic","store_product_page","engagement_type",
  "gdpr_applies","ad_user_data_enabled","ad_personalization_enabled","raw_consent_data",
  "total_candidates","tagged_type","tagged_additional_data","is_tagged","store_reinstall",
  "engagement_destination","detected_rule_name","detected_rule_id"
];

const EVENT_NAME_IDX = COLS.indexOf("event_name");
const EVENT_VALUE_IDX = COLS.indexOf("event_value");
const EVENT_REVENUE_USD_IDX = COLS.indexOf("event_revenue_usd");
const COUNTRY_IDX = COLS.indexOf("country_code");
const PLATFORM_IDX = COLS.indexOf("platform");
const BUNDLE_ID_IDX = COLS.indexOf("bundle_id");
const EVENT_TIME_IDX = COLS.indexOf("event_time");
const MEDIA_SOURCE_IDX = COLS.indexOf("media_source");
const IS_ORGANIC_IDX = COLS.indexOf("is_organic");

// S3 파일 읽기
async function readS3File(key) {
  const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  const buf = Buffer.concat(chunks);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// 6월 파일 목록 조회
async function getJuneFiles() {
  const files = [];
  for (const appId of APP_IDS) {
    for (let day = 1; day <= 30; day++) {
      const dt = `2026-06-${String(day).padStart(2, "0")}`;
      const prefix = `c7yL-acc-m4k6c7yL-c7yL/wemadeplay/t=inapps/dt=${dt}/`;
      let ct = undefined;
      do {
        const resp = await client.send(new ListObjectsV2Command({
          Bucket: bucket, Prefix: prefix, MaxKeys: 100, ContinuationToken: ct
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

console.log("6월 Idol Farm Life 파일 목록 조회 중...");
const files = await getJuneFiles();
console.log(`총 ${files.length}개 파일 처리 시작\n`);

const allPurchases = [];
let fileCount = 0;

for (const f of files) {
  fileCount++;
  process.stderr.write(`\r처리 중: ${fileCount}/${files.length} - ${f.dt}`);
  try {
    const ab = await readS3File(f.key);
    await parquetRead({
      file: ab,
      onComplete: (rows) => {
        rows.forEach(row => {
          if (row[EVENT_NAME_IDX] === "af_purchase") {
            // event_value 파싱 (JSON)
            let productName = null;
            let productId = null;
            let currency = null;
            let quantity = null;
            try {
              const ev = JSON.parse(row[EVENT_VALUE_IDX] || "{}");
              productName = ev.af_content || ev.af_content_id || ev.product_name || null;
              productId = ev.af_content_id || ev.product_id || null;
              currency = ev.af_currency || null;
              quantity = ev.af_quantity || null;
            } catch(e) {}

            allPurchases.push({
              date: (row[EVENT_TIME_IDX] || "").substring(0, 10),
              country: row[COUNTRY_IDX],
              platform: row[PLATFORM_IDX],
              bundle_id: row[BUNDLE_ID_IDX],
              revenue_usd: parseFloat(row[EVENT_REVENUE_USD_IDX]) || 0,
              media_source: row[MEDIA_SOURCE_IDX],
              is_organic: row[IS_ORGANIC_IDX],
              product_name: productName,
              product_id: productId,
              event_value_raw: row[EVENT_VALUE_IDX],
            });
          }
        });
      }
    });
  } catch(e) {
    // 파일 오류 무시
  }
}

console.log(`\n\n총 af_purchase 이벤트: ${allPurchases.length}건\n`);

if (allPurchases.length === 0) {
  console.log("구매 데이터가 없습니다.");
  process.exit(0);
}

// === 분석 1: 날짜별 구매 수 & 매출 ===
const byDate = {};
allPurchases.forEach(p => {
  if (!byDate[p.date]) byDate[p.date] = { count: 0, revenue: 0 };
  byDate[p.date].count++;
  byDate[p.date].revenue += p.revenue_usd;
});
console.log("=== 날짜별 구매 현황 ===");
Object.keys(byDate).sort().forEach(d => {
  console.log(`${d}: ${byDate[d].count}건, $${byDate[d].revenue.toFixed(2)}`);
});

// === 분석 2: 국가별 ===
const byCountry = {};
allPurchases.forEach(p => {
  if (!byCountry[p.country]) byCountry[p.country] = { count: 0, revenue: 0 };
  byCountry[p.country].count++;
  byCountry[p.country].revenue += p.revenue_usd;
});
console.log("\n=== 국가별 구매 현황 ===");
Object.entries(byCountry).sort((a,b) => b[1].count - a[1].count).forEach(([c, v]) => {
  console.log(`${c}: ${v.count}건, $${v.revenue.toFixed(2)}`);
});

// === 분석 3: OS별 ===
const byPlatform = {};
allPurchases.forEach(p => {
  const key = p.platform || "unknown";
  if (!byPlatform[key]) byPlatform[key] = { count: 0, revenue: 0 };
  byPlatform[key].count++;
  byPlatform[key].revenue += p.revenue_usd;
});
console.log("\n=== OS별 구매 현황 ===");
Object.entries(byPlatform).sort((a,b) => b[1].count - a[1].count).forEach(([p, v]) => {
  console.log(`${p}: ${v.count}건, $${v.revenue.toFixed(2)}`);
});

// === 분석 4: 구매 상품별 ===
const byProduct = {};
allPurchases.forEach(p => {
  const key = p.product_name || p.product_id || "알 수 없음";
  if (!byProduct[key]) byProduct[key] = { count: 0, revenue: 0 };
  byProduct[key].count++;
  byProduct[key].revenue += p.revenue_usd;
});
console.log("\n=== 구매 상품별 현황 ===");
Object.entries(byProduct).sort((a,b) => b[1].count - a[1].count).slice(0, 20).forEach(([prod, v]) => {
  console.log(`${prod}: ${v.count}건, $${v.revenue.toFixed(2)}`);
});

// === 분석 5: 미디어소스별 ===
const byMedia = {};
allPurchases.forEach(p => {
  const key = p.media_source || "unknown";
  if (!byMedia[key]) byMedia[key] = { count: 0, revenue: 0 };
  byMedia[key].count++;
  byMedia[key].revenue += p.revenue_usd;
});
console.log("\n=== 미디어소스별 구매 현황 ===");
Object.entries(byMedia).sort((a,b) => b[1].count - a[1].count).forEach(([m, v]) => {
  console.log(`${m}: ${v.count}건, $${v.revenue.toFixed(2)}`);
});

// event_value 샘플 (상품 파악용)
console.log("\n=== event_value 샘플 (첫 10건) ===");
allPurchases.slice(0, 10).forEach((p, i) => {
  console.log(`${i+1}. [${p.date}][${p.country}][${p.platform}] ${p.event_value_raw}`);
});
