# s3tool

Idol Farm Life(AppsFlyer Data Locker) 대시보드용 AWS S3 데이터 수집/분석 스크립트 모음. `mkt` 저장소의 하위 폴더로 관리되며, 여러 PC(회사/집)에서 이 저장소를 clone해 이어서 작업할 수 있다.

## 여러 PC에서 함께 쓸 때 알아둘 점

- **매일 오전 자동 갱신(`geo-cohort-daily-update`) 스케줄은 회사 PC에만 등록**한다. 두 PC 모두에 등록하면 같은 시간에 중복 실행되어 같은 아티팩트 URL에 동시에 재게시를 시도하는 충돌이 생긴다. 집 PC는 이 스케줄을 등록하지 않고, 필요할 때 수동으로 스크립트를 실행하거나 코드를 수정하는 용도로만 clone을 사용한다.
- 코드/스크립트를 수정한 뒤에는 **작업을 마친 PC에서 커밋·푸시**하고, 다른 PC에서 이어서 작업하기 전에 **`git pull`로 최신 상태를 먼저 받아온다** — 일반적인 다중 머신 git 사용과 동일.
- `*-result.json`, `data/`, `node_modules/`는 각 PC에서 로컬로 재생성되는 파일이라 git으로 동기화되지 않는다(정상 동작).

## 사전 준비물
- Node.js (v18+ 권장)
- Git
- AWS CLI (`aws configure` 사용)
- Claude Code (스케줄 작업/Artifact 재게시용)

## 새 PC(예: 집 PC)에서 시작하기

```bash
git clone https://github.com/seulkiim/mkt.git
cd mkt/s3tool
npm install
```

### AWS 자격증명 설정

이 저장소에는 어떤 AWS 액세스 키/시크릿 키도 들어있지 않다. 모든 스크립트는 `aws-client.mjs`를 통해 `AWS_PROFILE` 환경변수가 가리키는 AWS CLI 프로필(기본값 `idolfarm`)로 인증한다.

```bash
aws configure --profile idolfarm
# AWS Access Key ID / Secret Access Key는 AWS IAM 콘솔(또는 별도 보관처)에서 직접 발급받아 입력
# Region: ap-northeast-1
```

Windows에서 영구 환경변수로 등록(새 터미널부터 적용됨):
```powershell
setx AWS_PROFILE idolfarm
```

### 동작 확인

```powershell
$env:AWS_PROFILE = "idolfarm"   # 새 터미널을 안 열었다면 현재 세션에도 임시로 설정
node check-cost.mjs
```
S3 데이터가 정상 출력되면 설정 완료. `AWS_PROFILE`이 없으면 `aws-client.mjs`가 즉시 명확한 에러로 실패한다.

### 일일 스케줄 작업 (회사 PC 전용 — 집 PC에서는 등록하지 않음)

`geo-cohort-daily-update` 자동화(매일 오전 대시보드 2종 갱신·재게시)는 회사 PC의 Claude Code에만 등록되어 있다(Claude Code 자체 스케줄러에 등록되는 머신별 설정이라 git으로 옮겨지지 않음). **집 PC 등 추가로 clone하는 곳에는 이 스케줄을 등록하지 말 것** — 두 곳에서 동시에 실행되면 같은 아티팩트 URL에 중복 재게시를 시도해 충돌한다. 원본 프롬프트는 참고용으로 [`scheduled-task-template.md`](./scheduled-task-template.md)에 보관해두었으며, 회사 PC를 교체하는 등 스케줄을 옮겨야 할 상황이 생기면 그때 그 파일을 참고해 새 PC에서 `/schedule`로 재생성하면 된다.

### (선택) 매번 승인 프롬프트 없이 실행

Claude Code 프로젝트 로컬 설정(`.claude/settings.local.json`)에 이 폴더의 PowerShell 실행 규칙을 추가하면 스케줄 작업이 매번 승인 없이 자동 완료된다. 처음엔 프롬프트가 뜨는 대로 승인하면서 자연스럽게 쌓아가도 되고, 필요하면 기존 PC의 규칙을 참고해 미리 추가해도 된다.

## 폴더 구조 메모
- `aws-client.mjs` — 공용 S3 클라이언트/버킷 상수 (모든 스크립트가 여기서 import)
- `geo-cohort-os.mjs`, `collect-format-tree.mjs`, `gen-tree-artifact.mjs`, `gen-format-tree.mjs` — 일일 스케줄 작업이 실행하는 4개 스크립트
- 나머지 `check-*`, `verify-*`, `analyze-*`, `s3-*` — 필요할 때마다 만든 1회성 분석/디버그 스크립트
- `*-result.json`, `data/`, `node_modules/` — 전부 재생성 가능한 산출물이라 `.gitignore`에서 제외됨
