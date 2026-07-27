/**
 * The Telegram bot this build talks to. Deployment-specific, so it comes from the
 * build environment rather than being baked into the repository — a public repo
 * should not hard-code one team's bot handle.
 *
 * Set it at build time:  VITE_BOT_USERNAME=my_bot npm run build --workspace @planer/admin
 */
export const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME ?? "your_bot_username";

/** The bot deep link that redeems an invite token. */
export const inviteLinkFor = (inviteToken: string): string =>
  `https://t.me/${BOT_USERNAME}?start=${inviteToken}`;
