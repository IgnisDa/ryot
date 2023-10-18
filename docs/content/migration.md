# Migration

The steps for upgrade for most major releases are the same. The only difference is on steps
`2` and `4`.

1. Stop the running server and create a backup of your database.

2. Run the last release of the server as specified in the release you are upgrading to
   perform all migrations (make sure to connect it to the correct database).
   ```bash
   docker run --volume ./ryot/data:/data ghcr.io/ignisda/ryot:<last_release>
   ```

3. Once the migrations from the above step are done, stop the server.

4. Before upgrading to the public release, connect to the database again and run the SQL
   statements from the migration list of the release you are upgrading to.

5. Now you can upgrade to the latest release safely.

6. **OPTIONAL**: Once you have the new server up and running, go to the "Miscellaneous"
   settings page and click all the buttons one by one to update all the metadata. They
   will all be processed in the background.

## From `v2.*` to `v3.*`

Last release: `v2.24.1`

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

## From `v1.*` to `v2.*`

Last release: `v1.22.1`

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
