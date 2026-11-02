// Argument checks for tool handlers. Messages are what an agent sees, so they say what to send.

import { resolve } from 'node:path';

export class ArgError extends Error {}

export function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) throw new ArgError(`"${key}" is required (a string)`);
  return v;
}

export function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new ArgError(`"${key}" must be a string`);
  return v;
}

export function strList(args: Record<string, unknown>, key: string, min = 1, max = Infinity): string[] {
  const v = args[key];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new ArgError(`"${key}" must be a list of strings`);
  if (v.length < min || v.length > max) throw new ArgError(`"${key}" takes ${min}${max === Infinity ? ' or more' : `–${max}`} items, got ${v.length}`);
  return v as string[];
}

/** A path from the agent, made absolute against the server's working directory. */
export function path(args: Record<string, unknown>, key: string): string {
  return resolve(str(args, key));
}
