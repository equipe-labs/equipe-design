// OFL replacements for fonts we cannot hand out. Names only; no font file is ever stored.
const KNOWN: [RegExp, string][] = [
  [/^(sf pro|sf ui|-apple-system|system-ui|segoe ui|helvetica( neue)?|arial|roboto flex|söhne|sohne|neue haas)/i, 'Inter'],
  [/^(graphik|circular|proxima|gotham|avenir|futura|museo sans)/i, 'DM Sans'],
  [/^(gt america|gt walsheim|aeonik|general sans)/i, 'Instrument Sans'],
  [/^(georgia|times|tiempos|canela|freight)/i, 'Source Serif 4'],
  [/^(sf mono|menlo|monaco|consolas|courier|berkeley mono|söhne mono)/i, 'JetBrains Mono'],
];
const FREE = /^(inter|dm sans|instrument sans|source serif|jetbrains mono|ibm plex|noto|roboto|open sans|lato|manrope|figtree|geist|hanken|atkinson|fira|work sans|space grotesk|pretendard)/i;

export interface FontSwap {
  from: string;
  to: string;
  reason: string;
}

/** Picks the OFL alternative for one family name, or null when the name is already free or unknown. */
export function oflReplacement(name: string, oflAlternatives: string[], license: string | null): FontSwap | null {
  const clean = name.replace(/\s+variable$/i, '').trim();
  if (license && /ofl|apache|open font/i.test(license)) return null;
  if (FREE.test(clean)) return null;
  if (oflAlternatives[0]) return { from: name, to: oflAlternatives[0], reason: 'extraction listed an OFL alternative' };
  for (const [re, to] of KNOWN) if (re.test(clean)) return { from: name, to, reason: 'closest OFL family in the built-in list' };
  return null;
}
