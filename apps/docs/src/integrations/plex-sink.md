# Plex Sink

::: info
This will only import media that are in progress. Perform an
[import](../importing/plex.md) if you want to import media that are finished.
:::

Automatically add [Plex](https://www.plex.tv) show and movie plays to Ryot. It will
work for all the media that have a valid TMDb ID attached to their metadata.

1. Generate a slug in the integration settings page using the following settings:
    - Username => The exact value Plex sends as `Account.title` in its webhook payload.
       This is typically your Plex `Username`. This will be used to filter webhooks for
       the specified Plex account only. Leave it empty to accept events from all users.
2. In your Plex Webhooks settings, add a new webhook using the following settings:
    - Webhook Url => `<paste_url_copied>`

::: warning
Plex does not send the TMDb ID of a show, only the IDs of the episode. If the show is
not in the Ryot database yet, Ryot looks it up on TMDb using the IMDb or TVDB ID of the
episode. If Plex sends neither, progress will only be synced once the show is in the
Ryot database. To do this, simply add the show to your watchlist.
:::
