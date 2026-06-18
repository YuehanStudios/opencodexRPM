# 20 — Phase 3: Config & Init

> 작성: 2026-06-18 · Phase 3 PABCD

## 목표
`ocx init` 대화형 설정 + Codex config.toml 자동 주입.

## Done 기준
1. `ocx init` → 프로바이더 선택 → ~/.opencodex/config.json 생성
2. Codex config.toml에 [model_providers.opencodex] 자동 주입
3. `ocx init` 후 별도 설정 없이 `codex` 바로 사용 가능

## 파일 변경
```
src/
├── cli.ts                    ← MODIFY (init 서브커맨드 추가)
├── init.ts                   ← NEW (대화형 설정 워크플로우)
└── codex-inject.ts           ← NEW (config.toml 파싱 + 주입)
```

## 설계

### `ocx init` 플로우
1. 프로바이더 선택 (opencode-go / anthropic / openai / custom)
2. API 키 또는 인증 정보 입력
3. 기본 모델 선택
4. ~/.opencodex/config.json 생성
5. ~/.codex/config.toml에 model_providers.opencodex 주입
6. model_provider = "opencodex" 설정

### config.toml 주입 포맷
```toml
# Auto-injected by opencodex (ocx init)
model_provider = "opencodex"

[model_providers.opencodex]
name = "OpenCodex Proxy"
base_url = "http://localhost:10100/v1"
wire_api = "responses"
```

### TOML 파싱 전략
외부 TOML 파서 의존 대피: 정규식 기반 섹션 감지 + 텍스트 삽입.
이유: Codex config.toml은 단순 구조이고, 풀 파서 의존성을 추가하면 번들 사이즈가 불필요하게 증가.
