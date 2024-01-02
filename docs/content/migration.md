# Migration

All steps below are required unless otherwise stated. Please follow them in the correct
order.

## From `v3.*` to `v4.*`

!!! warning "Webhook URL changes"

    If you were using Plex, Jellyfin or Kodi, all webhooks urls will now have the `/backend`
    prefix. Please take a look at the [integration](integrations.md#sink-plugins) docs for the
    new format.

1. Upgrade the server to `v3.5.4` to make sure all pending migrations are applied. For example,
   you can make this change: `image: "ghcr.io/ignisda/ryot:v3.5.4"` in your docker-compose file.

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
   change: `image: "ghcr.io/ignisda/ryot:latest"` in your docker-compose file.

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
   $ docker run --volume ./ryot/data:/data ghcr.io/ignisda/ryot:v1.22.1
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
