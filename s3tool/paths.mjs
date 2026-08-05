import { fileURLToPath } from "url";
import { dirname, join } from "path";

// 결과 JSON·캐시·다운로드 데이터는 모두 이 스크립트 폴더(리포 내 s3tool/) 기준으로 해석한다.
// 리포를 다른 위치로 옮기거나 다시 clone 해도 그대로 동작하며, cwd에 의존하지 않는다.
export const S3TOOL_DIR = dirname(fileURLToPath(import.meta.url));
export const dataPath = (name) => join(S3TOOL_DIR, name);
