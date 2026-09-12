# Migration

All steps below are required unless otherwise stated. Directly upgrading across multiple
major versions is not supported. If you want to upgrade from a version older than the last
major release, please follow each major version's migration steps in order.

## From `v10.*` to `v11.*`

::: warning A bigger upgrade than usual
Ryot `v11` is a rewrite. Your data is converted automatically the first time `v11` starts,
but the upgrade needs a few extra steps, and you cannot go back to `v10` without a backup.
Read this whole section before you start.
:::

### Before you upgrade

1. Upgrade the server to `v10.5.2` to make sure all `v10` migrations are applied. For
   example, you can make this change: `image: "ignisda/ryot:v10.5.2"` in your
   docker-compose file.
2. Create a backup of your database. Follow this
   [guide](./backups.md#whole-server-backups). If you use S3 for file storage, back up your
   bucket too.

### Update your docker-compose file

`v11` needs [Redis](https://redis.io) alongside PostgreSQL, and a volume for the files you
upload if you do not use S3. The changes look like this:

```diff
 services:
   ryot-db:
     image: postgres:18-alpine
     # ...unchanged

+  ryot-redis:
+    image: redis:8-alpine
+    restart: unless-stopped
+    container_name: ryot-redis
+    volumes:
+      - redis_storage:/data

   ryot:
-    image: ignisda/ryot:v10
+    image: ignisda/ryot:v11
     pull_policy: always
     container_name: ryot
     restart: unless-stopped
+    mem_limit: 2g
+    memswap_limit: 2g
     ports:
       - "8000:8000"
     environment:
       - TZ=Europe/Amsterdam
+      - REDIS_URL=redis://ryot-redis:6379
       - FRONTEND_URL=https://ryot.your-domain.com
       - DATABASE_URL=postgres://postgres:postgres@ryot-db:5432/postgres
       - SERVER_ADMIN_ACCESS_TOKEN=28ebb3ae554fa9867ba0
+    volumes:
+      - ryot_storage:/home/ryot/storage

 volumes:
+  ryot_storage:
+  redis_storage:
   postgres_storage:
```

A few settings are now stricter:

- `FRONTEND_URL` is required. Set it to the exact address you open Ryot at, such as
  `https://ryot.your-domain.com`, with nothing after the domain or port.
- `SERVER_ADMIN_ACCESS_TOKEN` must be at least 32 characters long. If yours is shorter,
  generate a new one, for example with `openssl rand -hex 16`.

::: tip Using S3?
Keep your `FILE_STORAGE_S3_*` settings exactly as they were. Ryot moves your existing images
during the upgrade and needs access to the same bucket to do so. With S3 configured, you do not
need the `ryot_storage` volume. See [File Storage](./guides/file-storage.md).
:::

### Update your environment variables

Many settings have been renamed. Rename any of these that you use:

| Old name                             | New name                                            |
| ------------------------------------ | --------------------------------------------------- |
| `MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN` | `RYOT_PLUGIN_MEDIA_TMDB_ACCESS_TOKEN`               |
| `MOVIES_AND_SHOWS_TVDB_API_KEY`      | `RYOT_PLUGIN_MEDIA_TVDB_API_KEY`                    |
| `ANIME_AND_MANGA_MAL_CLIENT_ID`      | `RYOT_PLUGIN_MEDIA_MAL_CLIENT_ID`                   |
| `BOOKS_GOOGLE_BOOKS_API_KEY`         | `RYOT_PLUGIN_MEDIA_GOOGLE_BOOKS_API_KEY`            |
| `BOOKS_HARDCOVER_API_KEY`            | `RYOT_PLUGIN_MEDIA_HARDCOVER_API_KEY`               |
| `COMIC_BOOK_METRON_USERNAME`         | `RYOT_PLUGIN_MEDIA_METRON_USERNAME`                 |
| `COMIC_BOOK_METRON_PASSWORD`         | `RYOT_PLUGIN_MEDIA_METRON_PASSWORD`                 |
| `MUSIC_SPOTIFY_CLIENT_ID`            | `RYOT_PLUGIN_MEDIA_SPOTIFY_CLIENT_ID`               |
| `MUSIC_SPOTIFY_CLIENT_SECRET`        | `RYOT_PLUGIN_MEDIA_SPOTIFY_CLIENT_SECRET`           |
| `PODCASTS_LISTENNOTES_API_TOKEN`     | `RYOT_PLUGIN_MEDIA_LISTENNOTES_API_KEY`             |
| `VIDEO_GAMES_TWITCH_CLIENT_ID`       | `RYOT_PLUGIN_MEDIA_TWITCH_CLIENT_ID`                |
| `VIDEO_GAMES_TWITCH_CLIENT_SECRET`   | `RYOT_PLUGIN_MEDIA_TWITCH_CLIENT_SECRET`            |
| `VIDEO_GAMES_GIANT_BOMB_API_KEY`     | `RYOT_PLUGIN_MEDIA_GIANT_BOMB_API_KEY`              |
| `SERVER_IMPORTER_TRAKT_CLIENT_ID`    | `RYOT_PLUGIN_MEDIA_TRAKT_CLIENT_ID`                 |
| `SERVER_PROGRESS_UPDATE_THRESHOLD`   | `RYOT_PLUGIN_MEDIA_PROGRESS_UPDATE_THRESHOLD_HOURS` |

`SCHEDULER_INFREQUENT_CRON_JOBS_SCHEDULE` now takes a cron expression. If you set it, change a
value such as `every midnight` to `0 0 * * *`.

These settings no longer exist and can be deleted: `SERVER_BACKEND_HOST`,
`SERVER_BACKEND_PORT`, `SERVER_CORS_ORIGINS`, `SERVER_DISABLE_BACKGROUND_JOBS`,
`SERVER_GRAPHQL_PLAYGROUND_ENABLED`, `SERVER_MAX_FILE_SIZE_MB`,
`SERVER_SLEEP_BEFORE_STARTUP_SECONDS`, `USERS_TOKEN_VALID_FOR_DAYS`,
`FRONTEND_DASHBOARD_MESSAGE`, `BOOKS_OPENLIBRARY_COVER_IMAGE_SIZE` and
`VIDEO_GAMES_IGDB_IMAGE_SIZE`.

The [configuration](./configuration.md#all-parameters) page lists every setting `v11`
understands.

### Start Ryot

Start the server with the new image. The first start converts all your data, which can take a
while on a large library. Let it finish before you stop or restart the container.

If some of your data cannot be converted, Ryot stops and its logs explain what it found and how
to fix it. Restore your backup, fix the problem in `v10`, and then start `v11` again.

Once Ryot is running, open `<FRONTEND_URL>/god-mode`, unlock it with your
`SERVER_ADMIN_ACCESS_TOKEN`, and check the **Migration report**. It lists anything that was
skipped during the upgrade, such as an episode that could not be matched or an image that could
not be moved.

### Sign in again

Everyone is signed out after the upgrade.

**If you signed in with a username and password:**

- You now sign in with an email address instead of a username. If your username was already
  an email address, that is your new login. Otherwise, your login becomes your username
  followed by `@ryot.local`, such as `jane@ryot.local`.
- Old passwords no longer work. An administrator needs to open **God Mode > Users**, click
  **Generate reset link** for each user, and send them the link so they can choose a new
  password. The same page shows each person's new login email.

**If you signed in with OpenID Connect:** update the redirect URL in your provider to
`<FRONTEND_URL>/api/auth/callback/oidc` and allow the `openid email profile` scopes. See
[Authentication](./guides/authentication.md).

Administrator accounts are gone: server administration now happens in God Mode, which anyone
with the `SERVER_ADMIN_ACCESS_TOKEN` can unlock.

### Check your integrations

Your integrations and notification settings are carried over, including their passwords and
API keys. Webhook URLs for integrations that send data to Ryot (Plex, Jellyfin, Emby, Kodi and
the browser extension) keep working, so you do not need to change anything in those apps.

The Generic JSON integration has been removed and is not carried over.

### What to expect after the upgrade

Media that `v10` had already fetched keeps its posters and details. Items in your Monitoring
collection, podcasts, shows not from TMDB, and cast and crew pages are downloaded again as you
browse, so right after the upgrade some of them may show only their title for a moment.
Recommendations are not carried over and come back when an item is refreshed.

These are not carried over:

- Share links.
- Saved filters.
- Past import reports.
- Calendar and activity history.
- Notification history.
- Visibility settings and comments on reviews.
- Watch provider display settings.
- Photos attached to measurements.

These features have been removed:

- The Generic JSON importer.
- The old JSON export. Use [account backups](./backups.md) instead. Exports made with `v10`
  cannot be imported into `v11`.
