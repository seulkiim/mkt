import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdirSync } from "fs";

// 결과 JSON·캐시·다운로드 데이터는 모두 이 스크립트 폴더(리포 내 s3tool/) 기준으로 해석한다.
// 리포를 다른 위치로 옮기거나 다시 clone 해도 그대로 동작하며, cwd에 의존하지 않는다.
export const S3TOOL_DIR = dirname(fileURLToPath(import.meta.url));
export const dataPath = (name) => join(S3TOOL_DIR, name);

// 생성된 HTML 대시보드 출력 위치. 예전에는 세션별 임시폴더(AppData/Local/Temp/claude/…)에
// 하드코딩돼 있었는데, 그 폴더는 세션이 끝나면 정리될 수 있어 스크립트가 조용히 실패한다.
// 리포 안의 out/ 으로 고정하고, 없으면 만든다(.gitignore에 out/ 등록됨).
export const OUT_DIR = join(S3TOOL_DIR, "out");
export const outPath = (name) => {
  mkdirSync(OUT_DIR, { recursive: true });
  return join(OUT_DIR, name);
};
