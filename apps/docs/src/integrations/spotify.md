# Spotify <Badge type="warning" text="PRO" />

This integration reads your Spotify
[recently played tracks](https://developer.spotify.com/documentation/web-api/reference/get-recently-played)
on every sync and records each new play as a completed song with its play time and track length.

## Set up a Spotify app

1. Open the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and create an
   app that uses the **Web API**.
2. Add this redirect URI to the app exactly:

   ```txt
   <FRONTEND_URL>/api/oauth-connections/providers/media/spotify/callback
   ```

   Spotify accepts only HTTPS redirect URIs or the loopback addresses `http://127.0.0.1` and
   `http://[::1]`, so `FRONTEND_URL` must use one of those forms.

3. Set `RYOT_PLUGIN_MEDIA_SPOTIFY_CLIENT_ID` and `RYOT_PLUGIN_MEDIA_SPOTIFY_CLIENT_SECRET` to the
   app's client ID and secret. The same credentials also power Spotify music metadata.

A Spotify app in development mode allows up to five users that you add in the dashboard under
**User Management**. The app owner needs Spotify Premium, and accounts not added there receive a 403 error.

## Connect your account

Under **Settings > Integrations**, create a Spotify integration and select **Connect** to authorize
your Spotify account. Reconnect every six months, or sooner if the connection expires or is revoked,
by opening the integration and selecting **Connect** again.

A failed connection makes each sync fail. Turn on **Disable on continuous errors** if you want Ryot
to disable the integration and notify you once the connection stops working.

## Limitations

- The first sync backfills up to the 50 most recent plays.
- Spotify returns at most 50 plays per sync. Plays beyond that between two syncs are lost.
- Podcasts and other episodes are not supported.
- Two Spotify integrations for the same Spotify account record every play twice.
- [Importing a Spotify export](../importing/spotify.md) for days the integration already covers records those plays twice.
