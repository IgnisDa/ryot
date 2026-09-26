# Integrations

Open **Settings > Integrations** to create and manage integrations.

- **Sink:** an external service sends progress to Ryot.
- **Yank:** Ryot periodically reads progress from an external service.
- **Push:** Ryot sends an event to an external service.

Ryot pauses an integration after more than five consecutive failures unless you disable this
behavior in its settings.

## Sink integrations

Sink webhook URLs have this format:

```txt
https://<instance_url>/_i/<webhook_token>
https://app.ryot.io/_i/018f15d2-5d80-7b7b-9b41-31fe9268c4bb # example
```

::: warning
Keep webhook URLs private. The random token in the URL is a secret capability. Anyone with the URL
can send data to the integration.
:::

Ryot passes `multipart/form-data` and `application/json` bodies to the integration without changes.
It rejects other content types.

- [Ryot Browser Extension](./ryot-browser-extension.md) - Automatically scrobble media from
  streaming services <Badge type="warning" text="PRO" />
- [Jellyfin Sink](./jellyfin-sink.md) - Automatically add new Jellyfin movie and show plays
- [Emby](./emby.md) - Automatically add new Emby movie and show plays
- [Plex Sink](./plex-sink.md) - Automatically add Plex show and movie plays
- [Kodi](./kodi.md) - Sync current movie or TV show you are watching

## Yank integrations

Use **Sync all** under **Settings > Integrations** to run active Yank integrations now. Sink and
Push integrations respond to external events instead.

Set `SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE` to change the default five-minute interval.

With **Sync ownership** enabled, scheduled and manual checks add matching media to `Owned`.

- [Audiobookshelf](./audiobookshelf.md) - Sync media from Audiobookshelf
- [Komga](./komga.md) - Sync media from Komga
- [Plex Yank](./plex-yank.md) - Add all media in your libraries to "Owned" collection
- [YouTube Music](./youtube-music.md) - Sync music from YouTube Music <Badge type="warning" text="PRO" />

## Push integrations

- [Radarr](./radarr.md) - Send data to Radarr when items are added to collection
- [Sonarr](./sonarr.md) - Send data to Sonarr when items are added to collection
- [Jellyfin Push](./jellyfin-push.md) - Mark items as watched in Jellyfin <Badge type="warning" text="PRO" />
