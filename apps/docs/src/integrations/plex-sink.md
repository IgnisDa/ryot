# Plex Sink

::: info
This integration reads only in-progress media. Use an [import](../importing/plex.md) for finished
media.
:::

Media must have a valid TMDB ID.

1. Under **Settings > Integrations**, create a Plex Sink integration. The optional username must
   equal `Account.title` in the Plex webhook, usually the Plex username. Leave it empty to accept
   all users.
2. Copy the generated URL and add it under Plex **Webhooks**.

::: warning
Plex does not send the expected TMDB ID for shows. Add a show to Ryot before you sync its progress.
:::
