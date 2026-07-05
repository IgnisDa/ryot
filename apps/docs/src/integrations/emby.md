# Emby

This sink adds [Emby](https://emby.media) movie and show plays that have a valid TMDB ID.

1. Under **Settings > Integrations**, create an Emby integration and copy its webhook URL.
2. In Emby notification settings, add a webhook with name `ryot`, the copied URL,
   `application/json`, events `Play`, `Pause`, `Resume`, `Stop`, and `Progress`, and your user.

::: warning
Emby does not send the expected TMDB ID for shows. Add a show to Ryot before you sync its progress.
:::
