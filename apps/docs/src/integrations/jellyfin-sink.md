# Jellyfin Sink

This sink adds [Jellyfin](https://jellyfin.org) movie and show plays that have a valid TMDB ID.

::: info
Install and enable the [unofficial webhook plugin](https://github.com/shemanaev/jellyfin-plugin-webhooks)
in Jellyfin first.
:::

1. Under **Settings > Integrations**, create a Jellyfin Sink integration and copy its webhook URL.
2. In Jellyfin's webhook plugin, add that URL with `Default` payload format, your user, and events
   `Play`, `Pause`, `Resume`, `Stop`, and `Progress`.
