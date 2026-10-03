# AniList <Badge type="warning" text="PRO" />

This integration periodically syncs your current anime and manga list state from AniList. The
separate [AniList data import](../importing/anilist.md) still imports data from a downloaded GDPR
export, including history, ratings, favorites, and custom lists.

## Set up an AniList app

1. Open [AniList developer settings](https://anilist.co/settings/developer) and create an app.
2. Add this callback URL to the app exactly:

   ```txt
   <FRONTEND_URL>/api/oauth-connections/providers/media/anilist/callback
   ```

3. Set `RYOT_PLUGIN_MEDIA_ANILIST_CLIENT_ID` and `RYOT_PLUGIN_MEDIA_ANILIST_CLIENT_SECRET` on your
   Ryot server. Both are required to connect an
   AniList account. Keep the client secret on the server.

## Connect your account

Under **Settings > Integrations**, create an AniList integration and select **Connect**. Select **Connect** again to reconnect after the connection
expires or is revoked.

AniList does not offer permission scopes, so connecting grants full access to your AniList account.
The access token lasts one year and has no refresh token. Ryot cannot renew it automatically. Connect
again when it expires.

## What syncs

Ryot records the current list status, anime episode progress or manga chapter and volume progress,
repeat count, and any start or completion dates AniList provides. Partial dates stay partial. The first
sync records a current snapshot only; it does not create past episode or completion history. Later
changes in AniList update the current state. An unchanged poll does not add another snapshot, and
removing an entry from AniList does not delete its data from Ryot.

Ratings, notes, and custom lists do not sync through this integration. Use the separate [GDPR export
import](../importing/anilist.md) to import that data.

Syncs use the default five-minute frequent schedule. Set `SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE` to
change that interval. AniList requests share a limit of 30 requests per minute with AniList metadata
requests.
