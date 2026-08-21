# Trakt

::: info
It is necessary to set up TMDB for any Trakt import, including ZIP exports. Please follow
the configuration [guide](../configuration.md) for instructions.
:::

Ryot supports three Trakt import methods: a public user, a public list, or a ZIP export.
The User and List methods use the Trakt API and, on a self-hosted instance, require a Trakt
client ID in the environment variables as described in the [guide](../guides/trakt.md).
The Export ZIP method does not require a Trakt client ID.

## User

All movies and shows can be imported from [Trakt](https://trakt.tv) along with
their ratings, history, comments and lists.

::: info
It is necessary to set your account's privacy to public during the duration of the
import. Also, items that have been "check(ed) in" will not be imported.
:::

1. Login to your Trakt account and go to the settings page.
2. If your account is set to private, uncheck the box next to it. You can revert
  this change once the import is complete.
3. If you have any lists that are private, you need to change them to public.
  Otherwise they will not be imported.
4. Find your profile slug. This is usually your username. You can find it by
  going to your profile page, and checking the URL.
5. Enter this username in the input.

## List

All items from a public Trakt list can be imported and added to the collection of your
choice.

1. Enter a URL for the list to import. For example:

```txt
https://trakt.tv/users/felix66/lists/trakt-movie-the-new-york-times-guide-to-the-best-1-000-movies-ever-made?sort=rank,asc
```

2. Select the collection you want to import the items into.

## Export ZIP

You can request a ZIP export of your Trakt data from the [Trakt data export
settings](https://app.trakt.tv/settings/data). This method imports your history, ratings,
Owned, Watchlist, Favorites, custom lists, and comments.

1. Request and download your export from the Trakt data export settings.
2. Leave the downloaded ZIP file intact. Do not extract or modify it.
3. In Ryot, select **Trakt > Export ZIP** and upload the ZIP file.

Ryot uses the watched-history files to import watched items and ignores aggregate watched
files. Your Trakt profile and lists do not need to be public for this method, and a Trakt
client ID is not required.
