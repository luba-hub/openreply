# es-funnel (Efficiency Sprint's fork)

OpenReply sends one DM per keyword. This fork adds a short conversation for the Marketing Department reels:

1. Someone comments a niche word (ROOFING, REALTOR… the 60 in `config/niches.json`) on any post or reel.
2. The private reply asks for their first name and email, naming their niche. A `Lead` row opens: state and word.
3. Their reply (the `messages` webhook) is read by `lib/leads/handle.ts`, never by the keyword triggers:
   - with an email: one upsert into MailerLite (`MAILERLITE_GROUP_ID`, fields name + niche), then the blueprint link: `BLUEPRINT_BASE_URL/<slug>` (slug = the word in lowercase) while that page answers, else `BLUEPRINT_BASE_URL` itself;
   - only a name: "…where do I email it?" (the name waits on the lead until the link goes out); anything else: "a letter went missing"; one re-ask, then nothing more; MailerLite refusing the address counts the same;
   - MailerLite down: nothing is sent, the job retries; a lead already in MailerLite only gets the link on the retry.
The texts are the approved ones (es-operations `content/instagram/marketing-dept-reels/dm-flow.md` 69b303c1), in `lib/leads/texts.ts`; `LEAD_*_MESSAGE` overrides one. Its step 4 (a reminder 24 h after the ask with no reply) isn't sent: with no reply from them there's no open conversation, and Meta allows only the one private reply on a comment.

4. Every DM it sends takes a slot from the account's hourly cap (`DM_HOURLY_CAP`, below Meta's 750) and is logged in DM logs as `lead:<message id>`, with the word and the step, never the name or email. The stored webhook event and every stored comment text have each email replaced by `[email]`, and the queued job's text is dropped once handled (or once its last try fails).

## Set up

- `.env`: see the es-funnel block in `.env.example`. `ALLOWED_EMAILS` set to the owner's address only.
- Niche map: `node scripts/build-niches.mjs <es-operations>/content/instagram/marketing-dept-reels > config/niches.json` (slug = the word in lowercase).
- After an account is connected in Settings: `npx tsx scripts/es-funnel-campaign.ts <username>` makes (or updates) its one campaign: any post, all 60 words, collectLead on. `--off` pauses it.
- Backups: `/etc/cron.d/openreply-backup` dumps Postgres nightly to `/srv/openreply/backups` (mode 600, never pruned automatically).
- An account that ManyChat (or any DM tool) owns must hand the conversation over in Meta Business Suite first, or replies go to the other tool.

## Tests

`npm test`: `__tests__/leads.test.ts` (reading the reply, niches, MailerLite, every step of the conversation, the cap) and `__tests__/leads-webhook.test.ts` (the stored event holds no email), plus the worker hooks in `__tests__/dm-worker.test.ts`.
