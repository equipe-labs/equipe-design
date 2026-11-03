// What a crawl may follow, and what it must leave alone. Reading only: a link or control that
// could change something in the account (log out, delete, pay, invite, save settings, …) is
// never followed or pressed, and is listed in the result as skipped with the rule that hit.
// docs/crawl.md has the full list of rules and why.

/** Words that, as a whole word in a URL or a label, mean "this does something". */
const ACTION_WORDS = [
  // session
  'logout', 'logoff', 'signout',
  // destroy
  'delete', 'destroy', 'remove', 'trash', 'purge', 'erase', 'wipe', 'discard',
  // money
  'pay', 'payment', 'payments', 'checkout', 'purchase', 'buy', 'billing', 'subscribe', 'unsubscribe', 'upgrade', 'downgrade', 'refund', 'donate',
  // people
  'invite', 'invites', 'invitation', 'invitations', 'join', 'leave', 'kick', 'ban', 'unban', 'block', 'unblock', 'impersonate', 'sudo',
  // state changes
  'cancel', 'deactivate', 'activate', 'disable', 'enable', 'archive', 'unarchive', 'revoke', 'transfer', 'reset', 'regenerate', 'rotate',
  'approve', 'reject', 'merge', 'publish', 'unpublish', 'deploy', 'rollback', 'restore', 'send', 'resend', 'accept', 'decline', 'confirm', 'verify',
  'toggle', 'mute', 'unmute', 'pin', 'unpin', 'lock', 'unlock', 'close', 'reopen', 'resolve', 'assign', 'unassign',
  // social toggles (each press changes the account)
  'star', 'unstar', 'follow', 'unfollow', 'watch', 'unwatch', 'like', 'unlike', 'vote', 'upvote', 'downvote', 'fork', 'bookmark', 'mark',
  // forms
  'save', 'submit', 'apply', 'update', 'create', 'add', 'new', 'edit', 'rename', 'import', 'sync', 'run', 'retry', 'rerun', 'install', 'uninstall',
  // files
  'download', 'export',
];

/** URLs are judged on a narrower list: words that name a page to look at ("new", "edit", "settings") are fine to open with GET. */
const URL_ACTION_WORDS = new Set([
  'logout', 'logoff', 'signout', 'delete', 'destroy', 'remove', 'trash', 'purge', 'erase', 'wipe', 'discard',
  'pay', 'payment', 'checkout', 'purchase', 'buy', 'billing', 'subscribe', 'unsubscribe', 'upgrade', 'downgrade', 'refund', 'donate',
  'invite', 'invitation', 'join', 'leave', 'kick', 'ban', 'unban', 'block', 'unblock', 'impersonate', 'sudo',
  'cancel', 'deactivate', 'activate', 'disable', 'enable', 'archive', 'unarchive', 'revoke', 'transfer', 'reset', 'regenerate', 'rotate',
  'approve', 'reject', 'merge', 'publish', 'unpublish', 'deploy', 'rollback', 'restore', 'send', 'resend', 'accept', 'decline', 'confirm', 'verify',
  'toggle', 'mute', 'unmute', 'pin', 'unpin', 'lock', 'unlock', 'star', 'unstar', 'follow', 'unfollow', 'watch', 'unwatch', 'like', 'unlike', 'vote',
  'upvote', 'downvote', 'download', 'export', 'action', 'do', 'exec', 'execute', 'run', 'rerun', 'retry', 'sync', 'install', 'uninstall',
]);

/** Phrases (several words, or other languages) matched anywhere in a label or URL. */
const ACTION_PHRASES: RegExp[] = [
  /\blog[\s_-]?(out|off)\b/i,
  /\bsign[\s_-]?out\b/i,
  /\bmark[\s_-]?(as|all)\b/i,
  // Korean, Japanese, Chinese, German, French, Spanish, Portuguese: log out, delete, pay, invite, save
  /로그아웃|삭제|제거|결제|구매|구독|해지|초대|저장|탈퇴|취소|보내기|전송|승인|거절|병합|배포|게시|나가기|비활성|초기화/,
  /ログアウト|削除|購入|支払|招待|保存|退会|解約|送信/,
  /退出|注销|登出|删除|刪除|支付|购买|邀请|保存|取消订阅/,
  /\b(abmelden|löschen|bezahlen|einladen|speichern|kündigen)\b/i,
  /\b(déconnexion|supprimer|payer|inviter|enregistrer)\b/i,
  /\b(cerrar sesión|eliminar|borrar|pagar|invitar|guardar)\b/i,
  /\b(sair|excluir|pagar|convidar|salvar)\b/i,
];

const LABEL_WORDS = new Set(ACTION_WORDS);
/** A link is opened by its address (no script runs), so its label is held to the URL list, without words common in prose. */
const LINK_LABEL_WORDS = new Set([...URL_ACTION_WORDS].filter((w) => !['do', 'action', 'exec', 'execute'].includes(w)));

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Why a label names an action, or null. `control` is a button or menu trigger that would be
 * pressed (the full list, "save", "new", "edit" included); `link` a link that would be opened by its address.
 */
export function actionInLabel(label: string, kind: 'control' | 'link' = 'control'): string | null {
  const t = label.trim();
  if (!t) return null;
  for (const re of ACTION_PHRASES) {
    const m = re.exec(t);
    if (m) return `이름에 '${m[0]}'`;
  }
  const list = kind === 'control' ? LABEL_WORDS : LINK_LABEL_WORDS;
  for (const w of words(t)) if (list.has(w)) return `이름에 '${w}'`;
  return null;
}

/** Why a URL (path and query) names an action, or null. */
export function actionInUrl(u: URL): string | null {
  let path: string;
  try {
    path = decodeURIComponent(u.pathname);
  } catch {
    path = u.pathname;
  }
  for (const re of ACTION_PHRASES) {
    const m = re.exec(path);
    if (m) return `주소에 '${m[0]}'`;
  }
  for (const w of words(path)) if (URL_ACTION_WORDS.has(w)) return `주소에 '${w}'`;
  for (const [k, v] of u.searchParams) {
    // ?action=delete, ?do=logout, ?_method=DELETE
    if (/^(_?method|action|do|op|cmd|command)$/i.test(k) && v && !/^get$/i.test(v)) return `주소 매개변수 ${k}=${v}`;
    for (const w of words(v)) if (URL_ACTION_WORDS.has(w) && /^(action|do|op|cmd|command|type|mode)$/i.test(k)) return `주소 매개변수 ${k}=${v}`;
  }
  return null;
}

/** Files and feeds: not screens. */
const FILE_EXT = /\.(pdf|zip|tar|gz|tgz|bz2|xz|rar|7z|dmg|pkg|exe|msi|deb|rpm|apk|aab|ipa|png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|mp4|mov|webm|mkv|avi|mp3|wav|ogg|flac|m4a|csv|tsv|xlsx?|docx?|pptx?|odt|ods|json|xml|ya?ml|txt|md|patch|diff|rss|atom|ics|vcf|woff2?|ttf|otf|eot|css|js|mjs|map|wasm|bin|iso|img)$/i;
const FILE_SEGMENTS = new Set(['raw', 'media', 'attachments', 'releases/download', 'feed', 'feeds', 'rss', 'atom', 'api', 'graphql', 'oauth', 'oauth2', '.well-known', 'avatars', 'avatar', 'assets', 'static', 'cdn-cgi']);

export function notAScreen(u: URL): string | null {
  if (FILE_EXT.test(u.pathname)) return '파일·피드(화면 아님)';
  const segs = u.pathname.split('/').filter(Boolean).map((s) => s.toLowerCase());
  const hit = segs.find((s) => FILE_SEGMENTS.has(s));
  if (hit) return `'${hit}' 경로(화면 아님)`;
  return null;
}

const TRACKING = /^(utm_.+|fbclid|gclid|dclid|msclkid|mc_[ce]id|_ga|_gl|ref|ref_src|igshid|yclid)$/i;

/** One spelling per URL: no fragment, no tracking parameters, parameters sorted. */
export function normalizeUrl(u: URL): URL {
  const n = new URL(u.href);
  n.hash = '';
  const params = [...n.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  n.search = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  return n;
}

const ID_SEGMENT = [
  /^\d+$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // uuid
  /^(?=.*\d)[0-9a-f]{7,64}$/i, // hashes, commit ids
  /^[0-9A-HJKMNP-TV-Z]{26}$/, // ulid
  /^(?=.*\d)(?=.*[a-z])[a-z0-9_-]{16,}$/i, // long opaque ids (nanoid, cuid, base62)
  /^[\p{L}\p{N}-]*-\d{2,}$/u, // slug-123
  /^\d{4}-\d{2}(-\d{2})?$/, // dates
];

/**
 * The URL's shape: ids become `:id`, parameter values are dropped. `/project/123` and
 * `/project/456?tab=x` → `/project/:id?tab`. A crawl reads only a few URLs of each shape.
 */
export function urlPattern(u: URL): string {
  const segs = u.pathname.split('/').map((s) => {
    let d = s;
    try {
      d = decodeURIComponent(s);
    } catch {
      /* keep it */
    }
    return ID_SEGMENT.some((re) => re.test(d)) ? ':id' : d.toLowerCase();
  });
  const names = [...new Set([...u.searchParams.keys()].filter((k) => !TRACKING.test(k)))].sort();
  return segs.join('/') + (names.length ? `?${names.join('&')}` : '');
}

/** Paths of a login or sign-up screen: opening one with a session can end it or start a new one. */
export const AUTH_PATH = /\/(log-?in|sign-?in|sign-?up|register|auth|sso|session|sessions|password|forgot|two-factor|2fa|mfa|oauth2?|saml|account\/login)(\/|$)/i;
