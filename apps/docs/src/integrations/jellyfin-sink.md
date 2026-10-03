# Jellyfin Sink

This sink adds [Jellyfin](https://jellyfin.org) movie and show plays that have a valid TMDB ID, or a
valid TVDB ID when the integration's metadata provider is `tvdb`. It detects which of these webhook
plugins sent a request, so either works with the same URL:

- The [official webhook plugin](https://github.com/jellyfin/jellyfin-plugin-webhook), available in
  the Jellyfin plugin catalog.
- The [unofficial webhook plugin](https://github.com/shemanaev/jellyfin-plugin-webhooks).

Under **Settings > Integrations**, create a Jellyfin Sink integration and copy its webhook URL.

## Official plugin

1. Install the `Webhook` plugin from the Jellyfin plugin catalog and restart Jellyfin.
2. In the plugin settings, add a `Generic` destination with the copied URL, request method `POST`,
   and request content type `application/json`. Add a `Content-Type` header if the destination does
   not set one.
3. Select notification types `Playback Start` and `Playback Stop`, and optionally `Playback Progress`
   for finer progress. Select item types `Movies` and `Episodes`, and optionally restrict it to your
   user.
4. Enable **Send All Properties**.

## Unofficial plugin

In the webhook plugin settings, add the copied URL with `Default` payload format, your user, and
events `Play`, `Pause`, `Resume`, `Stop`, and `Progress`.

## Behavior

- Only movies and episodes are processed.
- Plays without the configured provider ID fail, including items that only have an IMDb ID.
- Plays marked as played to completion and `MarkPlayed` events record 100% progress. `MarkUnplayed`
  events are ignored.
- When the integration has a username, only plays by that user are processed.
