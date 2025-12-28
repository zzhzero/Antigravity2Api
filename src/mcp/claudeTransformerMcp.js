const { MCP_SWITCH_SIGNAL, isMcpSwitchEnabled } = require("./mcpSwitchFlag");

function hasMcpTools(claudeReq) {
  return (
    Array.isArray(claudeReq?.tools) &&
    claudeReq.tools.some((tool) => typeof tool?.name === "string" && tool.name.startsWith("mcp__"))
  );
}

function buildMcpToolNamesForHint(claudeReq) {
  const tools = Array.isArray(claudeReq?.tools) ? claudeReq.tools : [];
  const servers = new Set();
  for (const tool of tools) {
    const name = tool?.name;
    if (typeof name !== "string" || !name.startsWith("mcp__")) continue;
    const parts = name.split("__");
    if (parts.length >= 3 && parts[0] === "mcp" && parts[1]) servers.add(parts[1]);
  }
  const patterns = Array.from(servers)
    .sort()
    .map((server) => `mcp__${server}__*`);
  return patterns.length > 0 ? patterns.join("、") : "mcp__*";
}

function buildMcpSwitchModelHint(claudeReq) {
  const mcpToolNamesForHint = buildMcpToolNamesForHint(claudeReq);
  return `重要：当你需要使用任意 MCP 工具（名字以 mcp__ 开头，例如 ${mcpToolNamesForHint}）时，由于你直接调用MCP 工具会造成严重异常，所以需要通过${MCP_SWITCH_SIGNAL}通知用户，让用户自行选择，严禁直接调用任何MCP工具。你必须只输出下面这一行特殊字符串（完全一致，不要加任何其它文字）：\n${MCP_SWITCH_SIGNAL}，如果你要调用TodoWrite来分步完成MCP调用，也必须先输出下面这一行特殊字符串（完全一致，不要加任何其它文字）：\n${MCP_SWITCH_SIGNAL}`;
}

function maybeInjectMcpHintIntoSystemText({ text, claudeReq, isClaudeModel, injected }) {
  if (!isMcpSwitchEnabled()) return { text, injected };
  if (!isClaudeModel) return { text, injected };
  if (!hasMcpTools(claudeReq)) return { text, injected };
  if (typeof text !== "string" || !text.includes("mcp__")) return { text, injected };

  let nextText = text;

  // Remove explicit mcp__ tool names from system text, avoiding partial prefix stripping.
  for (const tool of Array.isArray(claudeReq?.tools) ? claudeReq.tools : []) {
    const name = tool?.name;
    if (typeof name === "string" && name.startsWith("mcp__")) {
      nextText = nextText.replaceAll(name, "");
    }
  }

  // Cleanup separators after deletions (commas/whitespace).
  nextText = nextText
    .replace(/,\s*,/g, ", ")
    .replace(/,\s*\n/g, "\n")
    .replace(/,\s*\)/g, ")")
    .replace(/\(\s*,/g, "(")
    .replace(/\s+,/g, ",")
    .replace(/,\s*$/gm, "")
    .replace(/ {2,}/g, " ");

  if (!injected) {
    nextText = `${nextText}\n\n${buildMcpSwitchModelHint(claudeReq)}`;
    return { text: nextText, injected: true };
  }

  return { text: nextText, injected };
}

module.exports = {
  maybeInjectMcpHintIntoSystemText,
};

