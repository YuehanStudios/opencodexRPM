---
title: 기여하기
description: opencodex 개발하기 — 설정, 구조, 컨벤션, 그리고 프로바이더나 어댑터를 추가하는 방법.
---

## 설정

```bash
git clone https://github.com/lidge-jun/opencodex.git
cd opencodex
bun install
bun run dev          # proxy in dev mode
bun x tsc --noEmit   # typecheck (must be clean)
```

웹 대시보드는 별도의 앱입니다:

```bash
cd gui && bun install && bun dev
```

지금 읽고 있는 문서 사이트는 `docs-site/`에 있습니다(Astro + Starlight):

```bash
cd docs-site && bun install && bun dev
```

## 컨벤션

- **ES Modules 전용**(`import`/`export`), TypeScript, `strict` 모드. `bun x tsc --noEmit`을 깨끗하게
  유지하세요.
- **파일당 최대 약 500줄** — 책임별로 분할하세요(`web-search/`와 `vision/` 사이드카가 단일
  `index.ts` 뒤에 작고 집중된 모듈을 둔 좋은 예입니다).
- **비동기 에러는 경계에서 처리** — 사이드카는 요청 경로로 절대 throw하지 않으며, 우아한 마커로
  성능을 낮춥니다.
- **Devlog** — 설계 노트는 10단위 범위 번호를 사용해 `devlog/NN_slug/`에 둡니다(`00–09` 리서치,
  `10–19` 1단계, …). 새 작업은 다음 10단위를 받습니다.
- **익스포트 보존** — 다른 모듈이 이에 의존할 수 있습니다.

## 카탈로그에 프로바이더 추가하기

대부분의 프로바이더는 API 키 카탈로그(`src/oauth/key-providers.ts`)의 항목 하나에 불과합니다:

```ts
"my-provider": {
  label: "My Provider",
  baseUrl: "https://api.example.com/v1",
  adapter: "openai-chat",
  dashboardUrl: "https://example.com/keys",
  models: ["model-a", "model-b"],
  defaultModel: "model-a",
  noVisionModels: ["model-a"],   // text-only models → vision sidecar describes images
}
```

`enrichProviderFromCatalog()`는 `models` / `noVisionModels` / `noReasoningModels`를 생성된
프로바이더 설정으로 복사하므로 분류가 자동으로 적용됩니다. OAuth 프로바이더의 경우 대신
`src/oauth/index.ts`의 `OAUTH_PROVIDERS`에 추가하세요.

## 어댑터 추가하기

`src/adapters/`에 `ProviderAdapter`([어댑터](/opencodex/ko/reference/adapters/) 참조)를 구현하고,
어댑터 리졸버에 등록한 뒤, 그 출력을 내부 `AdapterEvent`로 브리징하세요. 이미지 처리에는
`image.ts`를 재사용하고, 스트리밍 + 툴 호출의 레퍼런스로 `openai-chat.ts`를 따르세요.

## 완료를 주장하기 전에 검증하기

변경 사항을 증명하는 가장 좁은 명령을 실행하세요 — 타입에는 `bun x tsc --noEmit`, 동작에는 집중된
런타임 프로브. opencodex는 큰 배치보다 작고 검증 가능한 커밋을 선호합니다.
