# Migration

All steps below are required unless otherwise stated. Directly upgrading across multiple
major versions is not supported. If you want to upgrade from a version older than the last
major release, please follow each major version's migration steps in order.

## From `v9.*` to `v10.*`

:::warning Environment Variables Change

- If you had `SCHEDULER_FREQUENT_CRON_JOBS_EVERY_MINUTES=2` in your environment, then change
  it to `SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE="every 2 minutes"`. Read more about
  [yank integrations](./integrations/overview.md#yank-integrations).
- Localization-specific environment variables (eg: `MOVIES_AND_SHOWS_TMDB_LOCALE`,
  `ANIME_AND_MANGA_ANILIST_PREFERRED_LANGUAGE` etc.) have been removed and are now
  user level settings. Find them in language preference settings.
  :::

1. Upgrade the server to `v9.6.0` to make sure all `v9` migrations are applied. For
   example, you can make this change: `image: "ignisda/ryot:v9.6.0"` in your docker-compose
   file.
2. Create a backup of your database. Follow this
   [guide](./backups.md#whole-server-backups).
3. Now you can upgrade to the latest version (`v10.*`). For example you can make this
   change: `image: "ignisda/ryot:v10"` in your docker-compose file. This will
   automatically apply all migrations required for the new version.
