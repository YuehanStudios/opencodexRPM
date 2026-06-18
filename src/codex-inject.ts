import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CODEX_CONFIG_PATH = join(homedir(), ".codex", "config.toml");

const OCX_SECTION_MARKER = "# Auto-injected by opencodex";
const OCX_PROVIDER_BLOCK = `
${OCX_SECTION_MARKER}
[model_providers.opencodex]
name = "OpenCodex Proxy"
base_url = "http://localhost:{PORT}/v1"
wire_api = "responses"
`;

export function injectCodexConfig(port: number): { success: boolean; message: string } {
  if (!existsSync(CODEX_CONFIG_PATH)) {
    return { success: false, message: `Codex config not found at ${CODEX_CONFIG_PATH}. Is Codex installed?` };
  }

  let content = readFileSync(CODEX_CONFIG_PATH, "utf-8");

  if (content.includes("[model_providers.opencodex]")) {
    const portRegex = /base_url\s*=\s*"http:\/\/localhost:(\d+)\/v1"/;
    const match = content.match(portRegex);
    if (match && match[1] === String(port)) {
      return { success: true, message: "Codex config already configured for opencodex." };
    }
    content = content.replace(portRegex, `base_url = "http://localhost:${port}/v1"`);
    writeFileSync(CODEX_CONFIG_PATH, content, "utf-8");
    return { success: true, message: `Updated opencodex port to ${port} in Codex config.` };
  }

  const block = OCX_PROVIDER_BLOCK.replace("{PORT}", String(port));
  content = content.trimEnd() + "\n" + block + "\n";

  if (!content.includes("model_provider")) {
    const lines = content.split("\n");
    const insertIdx = lines.findIndex(l => l.startsWith("[")) ;
    if (insertIdx > 0) {
      lines.splice(insertIdx, 0, 'model_provider = "opencodex"', "");
    } else {
      lines.unshift('model_provider = "opencodex"');
    }
    content = lines.join("\n");
  }

  writeFileSync(CODEX_CONFIG_PATH, content, "utf-8");
  return { success: true, message: `Injected opencodex provider into ${CODEX_CONFIG_PATH}` };
}

export function removeCodexConfig(): { success: boolean; message: string } {
  if (!existsSync(CODEX_CONFIG_PATH)) {
    return { success: false, message: "Codex config not found." };
  }

  let content = readFileSync(CODEX_CONFIG_PATH, "utf-8");

  if (!content.includes("[model_providers.opencodex]")) {
    return { success: true, message: "opencodex not found in Codex config." };
  }

  const lines = content.split("\n");
  const filtered: string[] = [];
  let inOcxSection = false;

  for (const line of lines) {
    if (line.includes(OCX_SECTION_MARKER)) {
      inOcxSection = true;
      continue;
    }
    if (inOcxSection) {
      if (line.startsWith("[") && !line.includes("model_providers.opencodex")) {
        inOcxSection = false;
        filtered.push(line);
      }
      continue;
    }
    if (line.trim() === 'model_provider = "opencodex"') continue;
    filtered.push(line);
  }

  content = filtered.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  writeFileSync(CODEX_CONFIG_PATH, content, "utf-8");
  return { success: true, message: "Removed opencodex from Codex config." };
}

export function getCodexConfigPath(): string {
  return CODEX_CONFIG_PATH;
}
