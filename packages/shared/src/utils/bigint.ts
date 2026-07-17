/**
 * BigInt-safe serialization (SPEC §19, BUILD_BRIEF §5).
 *
 * Two layers:
 *  1. Wire serialization — `serializeForWire` / `stringifyForWire`: bigint →
 *     decimal string, Date → ISO string. Lossy on type but human/JSON friendly.
 *     This is what the REST/WS API emits.
 *  2. Tagged codec — `encodeTagged` / `decodeTagged` + `stringifyTagged` /
 *     `parseTagged`: round-trippable, restores bigint (and Date) exactly.
 */

export const BIGINT_TAG = '$bigint' as const;
export const DATE_TAG = '$date' as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// --- Wire serialization (lossy: bigint/Date -> string) ----------------------

export type WireValue = string | number | boolean | null | WireValue[] | { [k: string]: WireValue };

/** Deep-convert bigint → string and Date → ISO string; return JSON-safe value. */
export function serializeForWire(value: unknown): WireValue {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(serializeForWire);
  if (isPlainObject(value)) {
    const out: Record<string, WireValue> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = serializeForWire(v);
    }
    return out;
  }
  return value as WireValue;
}

/** JSON.stringify replacer that renders bigint as a decimal string. */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

export function stringifyForWire(value: unknown, space?: number): string {
  return JSON.stringify(serializeForWire(value), null, space);
}

// --- Tagged codec (round-trippable) -----------------------------------------

export function encodeTagged(value: unknown): unknown {
  if (typeof value === 'bigint') return { [BIGINT_TAG]: value.toString() };
  if (value instanceof Date) return { [DATE_TAG]: value.toISOString() };
  if (Array.isArray(value)) return value.map(encodeTagged);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = encodeTagged(v);
    return out;
  }
  return value;
}

export function decodeTagged(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeTagged);
  if (isPlainObject(value)) {
    const bigintTag = value[BIGINT_TAG];
    if (typeof bigintTag === 'string') {
      return BigInt(bigintTag);
    }
    const dateTag = value[DATE_TAG];
    if (typeof dateTag === 'string') {
      return new Date(dateTag);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = decodeTagged(v);
    return out;
  }
  return value;
}

export function stringifyTagged(value: unknown, space?: number): string {
  return JSON.stringify(encodeTagged(value), null, space);
}

export function parseTagged<T = unknown>(text: string): T {
  return decodeTagged(JSON.parse(text)) as T;
}
