---
title: 贡献指南
description: 开发 opencodex —— 环境搭建、目录结构、约定,以及如何添加 provider 或 adapter。
---

## 环境搭建

```bash
git clone https://github.com/lidge-jun/opencodex.git
cd opencodex
bun install
bun run dev          # proxy in dev mode
bun x tsc --noEmit   # typecheck (must be clean)
```

Web 仪表盘是一个独立的应用:

```bash
cd gui && bun install && bun dev
```

你正在阅读的文档站点位于 `docs-site/`(Astro + Starlight):

```bash
cd docs-site && bun install && bun dev
```

## 约定

- **仅使用 ES Modules**(`import`/`export`)、TypeScript、`strict` 模式。保持 `bun x tsc --noEmit` 无报错。
- **每个文件最多约 500 行** —— 按职责拆分(`web-search/` 和 `vision/` sidecar 就是隐藏在单个 `index.ts` 背后的小而专注模块的良好范例)。
- **在边界处处理异步错误** —— sidecar 绝不向请求路径抛出异常;它们会优雅地降级为一个标记。
- **Devlog** —— 设计笔记位于 `devlog/NN_slug/` 中,采用十位区间编号(`00–09` 调研,`10–19` 阶段 1,……)。新的工作使用下一个十位段。
- **保留导出(exports)** —— 其他模块可能依赖它们。

## 向目录中添加 provider

大多数 provider 只是 API-key 目录(`src/oauth/key-providers.ts`)中的一个条目:

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

`enrichProviderFromCatalog()` 会将 `models` / `noVisionModels` / `noReasoningModels` 复制到创建出的 provider 配置上,因此这些分类会自动生效。对于 OAuth provider,请改为添加到 `src/oauth/index.ts` 中的 `OAUTH_PROVIDERS`。

## 添加 adapter

在 `src/adapters/` 中实现 `ProviderAdapter`(见 [Adapters](/opencodex/zh-cn/reference/adapters/)),在 adapter 解析器中注册它,并将其输出桥接为内部的 `AdapterEvent`。图像处理请复用 `image.ts`,流式输出 + 工具调用请以 `openai-chat.ts` 作为参考。

## 在声称完成前先验证

运行能够证明你的更改的最小命令 —— 类型用 `bun x tsc --noEmit`,行为用一个聚焦的运行时探测。opencodex 倾向于小而可验证的提交,而非大批量提交。
