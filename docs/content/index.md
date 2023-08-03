# Migration

## From `v1.*` to `v2.*`

1. Stop the running server and create a backup of your database.

2. Run the last beta release of the server to perform all migrations (make sure to connect it to the correct database).

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

6. **OPTIONAL**: Once you have the new server up and running, go to the settings and click on the button to "Update All Metadata" under the miscellaneous tab.
