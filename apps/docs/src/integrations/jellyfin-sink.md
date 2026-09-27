# Jellyfin Sink

Automatically add new [Jellyfin](https://jellyfin.org) movie and show plays to Ryot. It
will work for all the media that have a valid TMDb ID (or TVDB ID, if selected in the
integration settings) attached to their metadata.

Two kinds of webhook plugins are supported and detected automatically:

- [Official webhook plugin](https://github.com/jellyfin/jellyfin-plugin-webhook)
  (available in the Jellyfin plugin catalog)
- [Unofficial webhook plugin](https://github.com/shemanaev/jellyfin-plugin-webhooks)

Generate a slug in the integration settings page and copy the newly generated webhook
URL. It looks like `https://<instance_url>/_i/<slug>`.

## Official plugin

1. Install the `Webhook` plugin from the Jellyfin plugin catalog and restart Jellyfin.
2. Go to the plugin settings and add a new `Generic` destination with the following
   settings:
    - Webhook URL => `<paste_url_copied>`
    - Request method => `POST`
    - Request content type => `application/json` (add a `Content-Type` header if the
      destination does not set it automatically)
    - Notification types => `PlaybackStart` and `PlaybackStop` (`PlaybackProgress`
      is optional, for finer-grained progress)
    - Item types => Enable `Movies` and `Episodes`
    - User filter => Optionally restrict to your user
3. Enable the `Send all properties` option on the destination. Ryot reads the flat
   payload (`NotificationType`, `ItemType`, `Provider_tmdb`, ticks, ...) directly.

## Unofficial plugin

1. In the Jellyfin webhook plugin settings, add a new webhook using the following
   settings:
    - Webhook URL => `<paste_url_copied>`
    - Payload format => `Default`
    - Listen to events only for => Choose your user
    - Events => `Play`, `Pause`, `Resume`, `Stop` and `Progress`

## Behavior notes

- Only `Movie` and `Episode` items are processed, everything else is ignored.
- A TMDb ID is required by default (or a TVDB ID if `TVDB` is selected as the
  metadata provider in the integration settings). Items with only an IMDb ID are
  skipped.
- If `PlayedToCompletion`/`Played` is set, progress is recorded as 100%.
- `MarkPlayed` events record 100% progress, `MarkUnplayed` events are ignored.
- If you configured a username in the integration settings, only payloads for that
  user are processed.
