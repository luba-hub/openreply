/**
 * es-funnel: reading a person's reply to "send me your first name and email".
 * The email is the first address in the text; the first name is the first word
 * left once the address and the usual lead-ins ("hi", "my name is"…) are gone.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const EMAILS = new RegExp(EMAIL.source, "g");
const LEAD_INS = new Set([
  "hi", "hey", "hello", "yo", "ok", "okay", "sure", "yes", "thanks", "thank", "you",
  "my", "name", "name's", "names", "is", "im", "i'm", "i", "am", "it's", "its", "this",
  "email", "e-mail", "mail", "and", "here", "it", "the", "me", "call",
]);

export interface LeadReply {
  email: string | null;
  firstName: string | null;
}

export function parseLeadReply(text: string): LeadReply {
  const found = text.match(EMAIL);
  const email = found ? found[0].replace(/\.+$/, "").toLowerCase() : null;
  const rest = text.replace(EMAILS, " ");
  let firstName: string | null = null;
  for (const word of rest.match(/[\p{L}][\p{L}'’-]*/gu) ?? []) {
    if (LEAD_INS.has(word.toLowerCase().replace("’", "'"))) continue;
    firstName = (word.charAt(0).toUpperCase() + word.slice(1)).slice(0, 40);
    break;
  }
  return { email, firstName };
}

/** Every email address in a string replaced, for anything that is stored or logged. */
export function redactEmails(text: string): string {
  return text.replace(EMAILS, "[email]");
}

/** The same, through any JSON value (a stored webhook payload). */
export function redactEmailsDeep<T>(value: T): T {
  if (typeof value === "string") return redactEmails(value) as T;
  if (Array.isArray(value)) return value.map(redactEmailsDeep) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactEmailsDeep(v)])
    ) as T;
  }
  return value;
}
