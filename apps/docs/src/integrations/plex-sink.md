# Plex Sink

::: info
This integration reads only in-progress media. Use an [import](../importing/plex.md) for finished
media.
:::

Media must have a valid TMDB ID. Set `RYOT_PLUGIN_MEDIA_TMDB_ACCESS_TOKEN`: Plex sends only episode
IDs, so Ryot looks up the show of each episode on TMDB, and the show does not need to be in Ryot
first.

1. Under **Settings > Integrations**, create a Plex Sink integration. The optional username must
   equal `Account.title` in the Plex webhook, usually the Plex username. Leave it empty to accept
   all users.
2. Copy the generated URL and add it under Plex **Webhooks**.
