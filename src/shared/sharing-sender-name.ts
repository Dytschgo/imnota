// Sender-name rules shared by the settings schema and the renderer. Kept free of zod so the
// renderer can validate the name without loading the schema library at startup.

export const SHARING_SENDER_NAME_MAX_CODE_POINTS = 80;

const UNPRINTABLE_SENDER_NAME = /[\p{C}‪-‮⁦-⁩]/u;

export function normalizeSharingSenderNameText(value: string): string {
  return value.normalize('NFC').trim();
}

/** Checks an already normalized name. */
export function sharingSenderNameTooLong(normalized: string): boolean {
  return [...normalized].length > SHARING_SENDER_NAME_MAX_CODE_POINTS;
}

/** Checks an already normalized name for control, format or bidirectional override characters. */
export function sharingSenderNameUnprintable(normalized: string): boolean {
  return UNPRINTABLE_SENDER_NAME.test(normalized);
}
