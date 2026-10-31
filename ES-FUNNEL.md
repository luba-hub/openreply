# es-funnel (Efficiency Sprint's fork)

OpenReply sends one DM per keyword. This fork adds a short conversation for the Marketing Department reels:

1. Someone comments a niche word (ROOFING, REALTOR… the 60 in `config/niches.json`) on any post or reel.
2. The private reply asks for their first name and email (`LEAD_ASK_MESSAGE`). A `Lead` row opens: state and word only.
3. Their reply (the `messages` webhook) is read by `lib/leads/handle.ts`, never by the keyword triggers:
   - with an email: one upsert into MailerLite (`MAILERLITE_GROUP_ID`, fields name + niche), then the niche's blueprint link (`BLUEPRINT_BASE_URL/<slug>`);
   - without one: one re-ask, then nothing more; MailerLite refusing the address counts the same;
   - MailerLite down: nothing is sent, the job retries; a lead already in MailerLite only gets the link on the retry.
4. Every DM it sends takes a slot from the account's hourly cap (`DM_HOURLY_CAP`, below Meta's 750) and is logged in DM logs as `lead:<message id>`, with the word and the step, never the name or email. The stored webhook event has every email replaced by `[email]`, and the queued job's text is dropped once handled.

## Set up

- `.env`: see the es-funnel block in `.env.example`. `ALLOWED_EMAILS` set to the owner's address only.
- Niche map: `node scripts/build-niches.mjs <es-operations>/content/instagram/marketing-dept-reels > config/niches.json` (slug from each niche's data yaml, else the word in lowercase).
- After an account is connected in Settings: `npx tsx scripts/es-funnel-campaign.ts <username>` makes (or updates) its one campaign: any post, all 60 words, collectLead on. `--off` pauses it.
- An account that ManyChat (or any DM tool) owns must hand the conversation over in Meta Business Suite first, or replies go to the other tool.

## Tests

`npm test`: `__tests__/leads.test.ts` (reading the reply, niches, MailerLite, every step of the conversation, the cap) and `__tests__/leads-webhook.test.ts` (the stored event holds no email), plus the worker hooks in `__tests__/dm-worker.test.ts`.
