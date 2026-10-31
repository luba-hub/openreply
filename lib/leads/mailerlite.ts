/**
 * es-funnel: one subscriber into MailerLite's group, with the first name and the niche.
 * POST /api/subscribers is an upsert in MailerLite (an existing subscriber is updated,
 * the group added). Errors carry the status only, never the address.
 */

export interface LeadSubscriber {
  email: string;
  firstName: string | null;
  niche: string;
}

export class MailerLiteError extends Error {
  constructor(public status: number, public retryable: boolean) {
    super(`MailerLite answered ${status}`);
    this.name = "MailerLiteError";
  }
}

export async function upsertSubscriber(sub: LeadSubscriber, fetchImpl: typeof fetch = fetch): Promise<void> {
  const key = process.env.MAILERLITE_API_KEY;
  const group = process.env.MAILERLITE_GROUP_ID;
  if (!key || !group) throw new Error("MAILERLITE_API_KEY and MAILERLITE_GROUP_ID must be set");
  const nameField = process.env.MAILERLITE_FIELD_NAME || "name";
  const nicheField = process.env.MAILERLITE_FIELD_NICHE || "niche";
  const base = (process.env.MAILERLITE_API_URL || "https://connect.mailerlite.com").replace(/\/+$/, "");
  const fields: Record<string, string> = { [nicheField]: sub.niche };
  if (sub.firstName) fields[nameField] = sub.firstName;
  const res = await fetchImpl(`${base}/api/subscribers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ email: sub.email, fields, groups: [group] }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 200 || res.status === 201) return;
  // 422: MailerLite refused the address (or a field); a retry won't change that.
  throw new MailerLiteError(res.status, res.status === 429 || res.status >= 500);
}
