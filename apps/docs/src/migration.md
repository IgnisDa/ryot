# Migration

All steps below are required unless otherwise stated. Directly upgrading across multiple
major versions is not supported. If you want to upgrade from a version older than the last
major release, please follow each major version's migration steps in order.

## From `v9.*` to `v10.*`

:::warning Environment Variables Change
If you had `SCHEDULER_FREQUENT_CRON_JOBS_EVERY_MINUTES=2` in your environment, then change
it to `SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE="every 2 minutes"`. Read more
[here](./integrations/overview.md#yank-integrations).
:::

1. Upgrade the server to `v9.6.0` to make sure all `v9` migrations are applied. For
   example, you can make this change: `image: "ignisda/ryot:v9.6.0"` in your docker-compose
   file.

2. Create a backup of your database. [Here](./exporting.md#exporting-the-entire-database)
   is a guide on how to do this.

3. Now you can upgrade to the latest version (`v10.*`). For example you can make this
   change: `image: "ignisda/ryot:v10"` in your docker-compose file. This will
   automatically apply all migrations required for the new version.

## From `v8.*` to `v9.*`

::: warning API Credentials Required
Default access tokens for MyAnimeList, Trakt, and TMDB have been removed. Self-hosted
instances must obtain their own API credentials before upgrading to v9.

This change was made because the shared default API keys were hitting rate limits and
exceeding free tier quotas due to Ryot's growing popularity with many self-hosted instances,
causing errors for all users.
:::

1. **REQUIRED**: Obtain and configure API credentials for the services you use:
   - **TMDB**: Follow the [movies and shows guide](./guides/movies-and-shows.md)
   - **Trakt**: Follow the [Trakt guide](./guides/trakt.md)
   - **MyAnimeList**: Follow the [anime and manga guide](./guides/anime-and-manga.md)

2. Upgrade the server to `v8.10.0` to make sure all `v8` migrations are applied. For
   example, you can make this change: `image: "ignisda/ryot:v8.10.0"` in your docker-compose
   file.

3. Create a backup of your database. [Here](./exporting.md#exporting-the-entire-database)
   is a guide on how to do this.

4. Now you can upgrade to the latest version (`v9.*`). For example you can make this
   change: `image: "ignisda/ryot:v9"` in your docker-compose file. This will
   automatically apply all migrations required for the new version.

## From `v7.*` to `v8.*`

1. Upgrade the server to `v7.16.0` to make sure all `v7` migrations are applied. For
   example, you can make this change: `image: "ignisda/ryot:v7.16.0"` in your docker-compose
   file.

2. Create a backup of your database. [Here](./exporting.md#exporting-the-entire-database)
   is a guide on how to do this.

3. Now you can upgrade to the latest version (`v8.*`). For example you can make this
   change: `image: "ignisda/ryot:v8"` in your docker-compose file. This will
   automatically apply all migrations required for the new version.

4. **OPTIONAL**: Login as the admin user and go to the "Miscellaneous" settings page and
   click on the button to "Perform background tasks".

## From `v6.*` to `v7.*`

1. Upgrade the server to `v6.11.0` to make sure all `v6` migrations are applied. For
   example, you can make this change: `image: "ignisda/ryot:v6.11.0"` in your docker-compose
   file.

2. Create a backup of your database. [Here](./exporting.md#exporting-the-entire-database)
   is a guide on how to do this.

3. Now you can upgrade to the latest version (`v7.*`). For example you can make this
   change: `image: "ignisda/ryot:v7"` in your docker-compose file. This will
   automatically apply all migrations required for the new version.

4. Login as the admin user and go to the "Miscellaneous" settings page and click on the
   button to "Perform background tasks".

## From `v5.*` to `v6.*`

::: warning Integrations deleted
All integrations will need to be recreated. Please take a look at the [docs](./integrations/overview.md)
for the new webhook format.
:::

1. Upgrade the server to `v5.5.6` to make sure all `v5` migrations are applied. For
   example, you can make this change: `image: "ignisda/ryot:v5.5.6"` in your docker-compose
   file.

2. Create a backup of your database. [Here](./exporting.md#exporting-the-entire-database)
   is a guide on how to do this.

3. Now you can upgrade to the latest version (`v6.*`). For example you can make this
   change: `image: "ignisda/ryot:latest"` in your docker-compose file. This will
   automatically apply all migrations.

## From `v4.*` to `v5.*`

1. Upgrade the server to `v4.4.3` to make sure all `v4` migrations are applied. For
   example, you can make this change: `image: "ignisda/ryot:v4.4.3"` in your docker-compose
   file.

2. Create a backup of your database. [Here](./exporting.md#exporting-the-entire-database)
   is a guide on how to do this.

3. Now you can upgrade to the latest version (`v5.*`). For example you can make this
   change: `image: "ignisda/ryot:latest"` in your docker-compose file. This will
   automatically apply all migrations.

## From `v3.*` to `v4.*`

::: warning Webhook URL changes
If you were using Plex, Jellyfin or Kodi, all webhooks urls will now have the `/backend`
prefix. Please take a look at the [integration](./integrations/overview.md#sink-integrations) docs for the
new format.
:::

1. Upgrade the server to `v3.5.4` to make sure all pending migrations are applied. For
   example, you can make this change: `image: "ignisda/ryot:v3.5.4"` in your docker-compose
   file.

2. Go to the "Preferences" settings, then the "General" tab, and click on "Disable yank
   integrations" twice. This will ensure that latest preferences have been applied.

3. Go to the "Miscellaneous" settings and click on "Re-evaluate workouts".

4. Next, click on the button to "Clean and regenerate" your summary. This takes time if
   you have a lot of media. Go to the dashboard and check the time under the "Summary"
   section. It should say "Calculated just now".

5. Logout and then clear the local storage and cookies for your domain.
   [Here](https://intercom.help/scoutpad/en/articles/3478364-how-to-clear-local-storage-of-web-browser)
   is a guide on how to do this. Uninstall the PWA if you have it installed.

6. [Create a backup](https://simplebackups.com/blog/docker-postgres-backup-restore-guide-with-examples/#back-up-a-docker-postgresql-database) of the database.

7. Connect to the database (`docker exec -u postgres -it ryot-db psql`) and run these SQL
   queries:
   ```sql
   DELETE FROM seaql_migrations;

   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230410_create_metadata', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230413_create_person', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230417_create_user', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230419_create_seen', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230501_create_metadata_group', 1697640078);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230502_create_genre', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230504_create_collection', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230505_create_review', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230509_create_import_report', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230622_create_exercise', 1697640078);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230804_create_user_measurement', 1697640078);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230819_create_workout', 1697640078);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230901_create_partial_metadata', 1697640078);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230912_create_calendar_event', 1697640078);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20231003_create_partial_metadata_to_person', 1697640078);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20231016_create_collection_to_entity', 1697640078);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20231017_create_user_to_entity', 1697640078);
   ```

8. Now you can upgrade to the latest version (`v4.*`) safely. For example you can make this
   change: `image: "ignisda/ryot:latest"` in your docker-compose file.

## From `v2.*` to `v3.*`

1. Upgrade the server to `v2.24.2` to make sure all pending migrations are applied.

2. Go to the "Miscellaneous" settings and click on the button to "Clean and regenerate"
   your summary. This takes time if you have a lot of media. Go to the dashboard and check
   the time under the "Summary" section. It should say "Calculated just now".

3. Go to the "Preferences" settings, then the "General" tab, and click any switch button
   twice to make sure the latest settings have been applied.

4. Stop the running server and create a backup of your database.

5. Connect to the database and run these SQL queries:
   ```sql
   DELETE FROM seaql_migrations;

   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230410_create_metadata', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230413_create_person', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230417_create_user', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230419_create_seen', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230502_create_genre', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230505_create_review', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230507_create_collection', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230509_create_import_report', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230622_create_exercise', 1697640078);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230804_create_user_measurement', 1697640078);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230819_create_workout', 1697640078);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230901_create_metadata_group', 1697640078);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230901_create_partial_metadata', 1697640078);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230912_create_calendar_event', 1697640078);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20231003_create_partial_metadata_to_person', 1697640078);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20231016_create_collection_to_entity', 1697640078);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20231017_create_user_to_entity', 1697640078);
   ```

6. Now you can upgrade to the latest release safely.

## From `v1.*` to `v2.*`

1. Stop the running server and create a backup of your database.

2. Run the last release of the server to perform all migrations (make sure to connect it to the correct database).
   ```bash
   $ docker run --volume ./ryot/data:/data ignisda/ryot:v1.22.1
   ```

3. Once the migrations from the above step are done, stop the server.

4. Before upgrading to the public release, connect to the database again and run these migrations:
   ```sql
   DELETE FROM seaql_migrations;

   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230410_create_metadata', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230412_create_creator', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230417_create_user', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230419_create_seen', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230502_create_genre', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230505_create_review', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230507_create_collection', 1684693316);
   INSERT INTO seaql_migrations (version, applied_at) VALUES ('m20230509_create_import_report', 1684693316);
   ```

5. Now you can upgrade to the latest release safely.

6. **OPTIONAL**: Once you have the new server up and running, go to the "Miscellaneous" settings page and click on the button to "Update All Metadata".
