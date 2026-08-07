// 수집 스크립트 2종(geo-cohort-os.mjs, collect-format-tree.mjs)이 같은 대상 기간을 보게 하는 단일 창구.
//
// 종료일을 각 스크립트가 자기 프로세스 시작 시각으로 계산하면, 한 회차가 자정을 걸칠 때
// 먼저 뜬 쪽과 나중에 뜬 쪽의 "전일"이 하루 어긋난다(2026-08-06 실측: A는 08-05까지, B는 08-06까지).
// 그래서 회차 단위로 종료일을 한 번만 정하고 GEO_END로 두 프로세스에 넘긴다.
// GEO_END가 없으면 종전처럼 전일(KST)로 계산한다 — 수동 단발 실행용 기본값.

export const START = "2026-07-07";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function yesterdayKST() {
  return new Date(Date.now() + 9 * 3600000 - 24 * 3600000).toISOString().slice(0, 10);
}

function resolveEnd() {
  const raw = (process.env.GEO_END || "").trim();
  if (!raw) return yesterdayKST();
  if (!YMD.test(raw) || Number.isNaN(Date.parse(raw + "T00:00:00Z"))) {
    throw new Error(`GEO_END 형식 오류: "${raw}" — YYYY-MM-DD 여야 합니다.`);
  }
  if (raw < START) {
    throw new Error(`GEO_END(${raw})가 START(${START})보다 앞섭니다.`);
  }
  return raw;
}

export const END = resolveEnd();
export const END_SOURCE = process.env.GEO_END ? "GEO_END(회차 공유)" : "전일(KST) 자동계산";

// START ~ END 사이의 날짜 문자열 배열(오름차순).
export function dateRange() {
  const out = [];
  for (let t = Date.parse(START + "T00:00:00Z"); t <= Date.parse(END + "T00:00:00Z"); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
