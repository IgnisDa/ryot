# Plex Sink

::: info
This will only import media that are in progress. Perform an
[import](../importing/plex.md) if you want to import media that are finished.
:::

Automatically add [Plex](https://www.plex.tv/) show and movie plays to Ryot. It will
work for all the media that have a valid TMDb ID attached to their metadata.

1. Generate a slug in the integration settings page using the following settings:
    - Username => Your Plex `Fullname`. If you have no `Fullname` specified in Plex,
       fallback to your Plex `Username`. This will be used to filter webhooks for the
       specified Plex account only.
2. In your Plex Webhooks settings, add a new webhook using the following settings:
    - Webhook Url => `<paste_url_copied>`

::: warning
Since Plex does not send the expected TMDb ID for shows, progress will only be synced
if you already have the show in the Ryot database. To do this, simply add the show to
your watchlist.
:::
