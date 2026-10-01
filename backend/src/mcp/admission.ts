import { getConfig } from '../config/env.js';
import { authChallengeRepository } from '../repositories/authChallengeRepository.js';
import type { McpPrincipal } from '../services/accessTokenService.js';
import { getUsageContext } from '../lib/usageContext.js';
import { admitPaidWork } from '../services/paidWorkAdmission.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export type McpAdmission = { ok: true } | { ok: false; code: string; message: string };

// Admission for tools that spend AI budget. The namespace's daily usage budget is the
// same one the website uses; the per-grant daily ceiling (one personal token, or one
// connected assistant) bounds a misbehaving host.
// Every attempt counts, including ones that later fail.
export const admitPaidCall = (principal: McpPrincipal, now: number = Date.now()): McpAdmission => {
  const ceiling = getConfig().MCP_DAILY_PAID_CALLS_PER_TOKEN;
  if (ceiling === 0) {
    return { ok: false, code: 'paid_tools_disabled', message: 'Playing through an assistant is paused on this server right now. Reading adventures still works.' };
  }
  const admission = admitPaidWork('assistant', { namespaceId: principal.namespaceId, attribution: getUsageContext()?.attribution }, new Date(now));
  if (!admission.ok) {
    return { ok: false, code: admission.refusal.error, message: admission.refusal.message };
  }
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const count = authChallengeRepository.incrementRateLimit(`mcp-paid:${principal.grantId}`, dayStart);
  if (count > ceiling) {
    return { ok: false, code: 'token_daily_limit', message: `This token reached its ${ceiling} assistant actions for today. It resets at midnight UTC.` };
  }
  return { ok: true };
};
