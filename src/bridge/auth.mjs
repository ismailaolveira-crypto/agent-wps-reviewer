import { timingSafeEqual } from 'node:crypto';

export function readAgentTokenFromRequest(req) {
  const explicit = req.headers['x-wps-reviewer-token'];
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();

  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();

  const cookieHeader = typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
  const cookie = cookieHeader
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith('wps-reviewer-token='));
  if (!cookie) return '';
  try {
    return decodeURIComponent(cookie.slice('wps-reviewer-token='.length));
  } catch {
    return '';
  }
}

function safeEquals(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function isAgentAuthorized(req, agentToken = '') {
  if (!agentToken) return true;
  const provided = readAgentTokenFromRequest(req);
  return Boolean(provided) && safeEquals(provided, agentToken);
}

export function buildAgentAuthHeaders(token = '') {
  if (!token) return {};
  return {
    authorization: `Bearer ${token}`,
    'x-wps-reviewer-token': token
  };
}
