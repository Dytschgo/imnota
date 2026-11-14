// User-facing local agent access (MCP) errors. Kept here so tests can check the Settings path
// against SETTINGS_CATEGORIES; the toggle lives in Settings → Features → MCP access.
export const AGENT_ACCESS_OFF_MESSAGE = 'Local agent access is off. Enable it in Settings → Features.';

export const AGENT_ACCESS_PORT_IN_USE_MESSAGE =
  'Local agent access could not start. Port 17384 may be in use. Access is off; free the port and enable it again in Settings → Features.';
