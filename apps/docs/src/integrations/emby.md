# Emby

Automatically add new [Emby](https://emby.media/) movie and show plays to Ryot. It
will work for all the media that have a valid TMDb ID attached to their metadata.

1. Generate a slug in the integration settings page. Copy the newly generated
   webhook Url.
2. In the Emby notification settings page, add a new notification using the
   Webhooks option:
    - Name => `ryot`
    - Url => `<paste_url_copied>`
    - Request Content Type => `application/json`
    - Events => `Play`, `Pause`, `Resume`, `Stop` and `Progress`
    - Limit user events to => Choose your user

::: warning
Since Emby does not send the expected TMDb ID for shows, progress will only be synced
if you already have the show in the Ryot database. To do this, simply add the show to
your watchlist.
:::
