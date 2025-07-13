# Jellyfin Sink

Automatically add new [Jellyfin](https://jellyfin.org/) movie and show plays to Ryot. It
will work for all the media that have a valid TMDb ID attached to their metadata.

::: info
Requires the
[unofficial webhook plugin](https://github.com/shemanaev/jellyfin-plugin-webhooks)
to be installed and active in Jellyfin.
:::

1. Generate a slug in the integration settings page. Copy the newly generated
   webhook Url.
2. In the Jellyfin webhook plugin settings, add a new webhook using the
   following settings:
    - Webhook URL => `<paste_url_copied>`
    - Payload format => `Default`
    - Listen to events only for => Choose your user
    - Events => `Play`, `Pause`, `Resume`, `Stop`, `Progress` and `MarkPlayed`
