const MCP_SWITCH_SIGNAL = "AG2API_SWITCH_TO_MCP_MODEL";

function getMcpSwitchModel() {
  const raw = process.env.AG2API_SWITCH_TO_MCP_MODEL;
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  return trimmed ? trimmed : null;
}

function isMcpSwitchEnabled() {
  return !!getMcpSwitchModel();
}

module.exports = {
  MCP_SWITCH_SIGNAL,
  getMcpSwitchModel,
  isMcpSwitchEnabled,
};

