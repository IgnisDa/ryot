# Trakt

::: info
All Trakt imports, including ZIP exports, require
`RYOT_PLUGIN_MEDIA_TMDB_ACCESS_TOKEN`.
:::

Choose User, List, or Export ZIP under **Settings > Import data**. User and List use the Trakt API
and require `RYOT_PLUGIN_MEDIA_TRAKT_CLIENT_ID`; ZIP does not. See the [Trakt guide](../guides/trakt.md).

## User

This method imports movies, shows, ratings, history, comments, and lists.

::: info
The account and relevant lists must be public during import. Checked-in items are not imported.
:::

1. Log in to Trakt and make your account and imported lists public.
2. Find the profile slug in your profile URL. It is usually your username.
3. Enter the slug in Ryot. You can restore Trakt privacy after the import.

## List

This method adds all items from one public list to a selected collection.

1. Enter the full list URL. Query parameters are allowed. For example:

```txt
https://trakt.tv/users/felix66/lists/trakt-movie-the-new-york-times-guide-to-the-best-1-000-movies-ever-made?sort=rank,asc
```

2. Select the destination collection.

## Export ZIP

This method imports history, ratings, Owned, Watchlist, Favorites, custom lists, and comments.

1. Request and download an export from [Trakt data settings](https://app.trakt.tv/settings/data).
2. Do not extract or modify the ZIP file.
3. Select **Trakt > Export ZIP** and upload it.

Ryot imports watched-history files and ignores aggregate watched files. The profile and lists can
remain private.
