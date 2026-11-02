// No logins and no workarounds. There is no option to pass cookies, storage state or
// extra headers: every run gets a new, empty browser profile (Playwright's default
// context) that is thrown away at the end. The engine never attaches to an existing
// browser (no connectOverCDP, no user data dir), so the person's signed-in browser and the
// squad's shared `browser` tool are out of reach. No stealth, proxies or captcha handling.

export interface PageCheck {
  passwordFields: number;
  textLength: number;
  challenge: boolean;
  forms: number;
  elements: number;
}

export type Wall = 'login-required' | 'bot-challenge' | null;

const LOGIN_PATH = /\/(log-?in|sign-?in|auth|sso|account\/login|session)(\/|$|\?)/i;

/** Decides from the response and a few counts read on the page whether to stop. */
export function detectWall(input: { status: number | null; requestedUrl: URL; finalUrl: URL | null; check: PageCheck }): { wall: Wall; reason: string | null } {
  const { status, requestedUrl, finalUrl, check } = input;
  if (check.challenge) return { wall: 'bot-challenge', reason: '봇 확인 페이지(캡차·챌린지)가 나옴' };
  if (status === 401 || status === 403) {
    return check.challenge || check.textLength < 2000
      ? { wall: status === 403 && check.passwordFields === 0 ? 'bot-challenge' : 'login-required', reason: `HTTP ${status}` }
      : { wall: 'login-required', reason: `HTTP ${status}` };
  }
  if (finalUrl && !LOGIN_PATH.test(requestedUrl.pathname) && LOGIN_PATH.test(finalUrl.pathname + finalUrl.search)) {
    return { wall: 'login-required', reason: '로그인 화면으로 리다이렉트됨' };
  }
  // A password field standing in for the page: little else on it.
  if (check.passwordFields > 0 && (check.textLength < 1500 || check.elements < 150)) {
    return { wall: 'login-required', reason: '비밀번호 입력란이 본문을 대신함' };
  }
  return { wall: null, reason: null };
}
