<script setup>
import variables from "../variables";
</script>

# Integrations

Integrations can be used to continuously update your media progress or inform external
services about changes. They can be of following types:

- _Sink_: An external client publishes progress updates to the Ryot server.
- _Yank_: Progress data is downloaded from an externally running server at a periodic
  interval.
- _Push_: Ryot sends data to an external service when an event occurs.

If an integration fails more than 5 times in a row, it will be automatically paused. This
behavior can be disabled from the integration's settings.

## Sink integrations

These work via webhooks wherein an external service can inform Ryot about a change. All
webhook URLs follow this format:

```txt
https://<instance_url>/_i/<slug>
https://app.ryot.io/_i/int_a6cGGXEq6KOI # example
```

::: warning
Keep your webhook urls private to prevent abuse.
:::

- [Ryot Browser Extension](./ryot-browser-extension.md) - Automatically scrobble media from
  streaming services <Badge type="warning" text="PRO" />
- [Jellyfin Sink](./jellyfin-sink.md) - Automatically add new Jellyfin movie and show plays
- [Emby](./emby.md) - Automatically add new Emby movie and show plays
- [Plex Sink](./plex-sink.md) - Automatically add Plex show and movie plays
- [Kodi](./kodi.md) - Sync current movie or TV show you are watching
- [Generic Json](./generic-json.md) - Import data using generic JSON format

## Yank integrations

You can configure the interval at which the data is fetched from the external source using
the `SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE` environment variable. Defaults to `every 5 minutes`.

If you have enabled the `Sync to owned collection` option, the integration will also run
at night to add all media in your instance to your "Owned" collection.

- [Audiobookshelf](./audiobookshelf.md) - Sync media from Audiobookshelf
- [Komga](./komga.md) - Sync media from Komga
- [Plex Yank](./plex-yank.md) - Add all media in your libraries to "Owned" collection
- [Youtube Music](./youtube-music.md) - Sync music from Youtube Music <Badge type="warning" text="PRO" />

## Push integrations

You can enable the following push integrations:

- [Radarr](./radarr.md) - Send data to Radarr when items are added to collection
- [Sonarr](./sonarr.md) - Send data to Sonarr when items are added to collection
- [Jellyfin Push](./jellyfin-push.md) - Mark items as watched in Jellyfin <Badge type="warning" text="PRO" />
