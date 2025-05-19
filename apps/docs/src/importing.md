# Importing

Importing is meant to be a one-time operation. They are irreversible, i.e., importing from
the same source twice will create duplicates. I recommend you to make a database backup
before starting an import.

An import can fail at various steps. Ryot creates a report when an import completes/fails.
You can see the reports under "Import History" of the imports page.

## Notes

- Imports are very difficult to have 100% success rate. Though we try our best,
  you might have to manually import some data from your previous provider.
- Imports might take a long time since Ryot needs to fetch all metadata from the sources
  before it can start importing progress. Estimated finish time is displayed in the UI.
- I recommend turning on debug logging for the duration of the import using the
  `RUST_LOG=ryot=debug` environment variable. This will help you help you see import
  progress in the docker logs.

## Jellyfin

You can import your watched movies and shows from [Jellyfin](https://jellyfin.org).

::: info
This will only import media that are already finished. Setup an
[integration](./integrations.md#jellyfin) if you want to import media in progress.
:::

Enter the correct details in the input. The username you enter should be of the account
whose data you want to import.

## Plex

You can import your watched movies and shows from [Plex](https://plex.tv).

::: info
This will only import media that are already finished. Setup an
[integration](./integrations.md#plex-sink) if you want to import media in progress.
:::

1. Obtain a `Plex-Token` as described
   [here](https://www.plexopedia.com/plex-media-server/general/plex-token/#getcurrentusertoken).
2. Enter the correct details in the inputs.

## Trakt

All movies and shows can be imported from [Trakt](https://trakt.tv) along with
their ratings, history, comments and lists. A few points to note.

- It is necessary to set your account's privacy to public during the
  duration of the import.
- Items that have been "check(ed) in" will not be imported.

---

1. Login to your Trakt account and go to the settings page.
2. If your account is set to private, uncheck the box next to it. You can revert
  this change once the import is complete.
1. If you have any lists that are private, you need to change them to public.
  Otherwise they will not be imported.
1. Find your profile slug. This is usually your username. You can find it by
  going to your profile page, and checking the URL.
1. Enter this username in the input.

## Audiobookshelf

The Audiobookshelf importer supports importing all media that have a valid Audible ID or
ITunes ID or ISBN.

::: info
- This will only import media that are already finished. Setup an
[integration](./integrations.md#audiobookshelf) if you want to import media in progress.
- If you have enabled the option to auto delete podcast episodes, you'll have to
manually mark them as completed.
:::

1. Obtain an API token as described in the Audiobookshelf
  [authentication](https://api.audiobookshelf.org/#authentication) docs.
1. Enter the correct details in the input.

## Goodreads

Ryot translates [Goodreads](https://www.goodreads.com/) shelves in the
following manner:

- Want To Read -> Watchlist

---

1. Login to your Goodreads account and go to the "My Books" section.
2. Click on "Import and export" on the left sidebar.
3. Click on "Export Library" and download the CSV file.
4. Upload this file in the input.

## MediaTracker

You can import from [MediaTracker](https://github.com/bonukai/MediaTracker), with
the following caveats:

- Items that are in progress are always imported with 100% progress. They are
  added to the "In Progress" collection so you can manually fix their progress
  if needed.

---

1. Login to your MediaTracker account and click on your name on the top right.
2. Click on the "Application tokens" section.
3. Enter a name and click on "Add token".
4. Copy the token that was just generated.
5. Enter the details in the inputs.

## Generic Json

The "Generic Json" can be used to import all possible data from a generic JSON file. The
format of the JSON file should be `CompleteExport` as described in the
[exporting](guides/exporting.md#type-definitions) documentation.

You can use this to export all your data from one Ryot instance and import it into another,
or from a source that is not supported by Ryot.

## Movary

The Watchlist and all movies can be imported from [Movary](https://movary.org)
along with ratings, history, and comments.

1. Login to your Movary account and go to the settings page. Go to "Personal data"
  under the "Account" section.
2. Export "history.csv", "watchlist.csv" and "ratings.csv".
3. Upload these files in the input.

## MyAnimeList

Manga and Anime can be imported from [MyAnimeList](https://myanimelist.net) along with
ratings, history and progress.

1. Login to your MyAnimeList account and go to
  [exports](http://myanimelist.net/panel.php?go=export).
2. Export your anime and manga history.
3. Upload these files in the input.

## Anilist

Manga and anime can be imported from [Anilist](https://anilist.co) along with ratings,
history, favorites and custom lists.

1. Login to your Anilist account and go to your [account
  settings](https://anilist.co/settings/account).
2. Scroll down to the "GDPR Data Download" section and click on "Download".
3. Upload the JSON file in the input.

## StoryGraph

Imports from [StoryGraph](https://thestorygraph.com) work using ISBN. All books
in your export that have an ISBN attached to them will be imported. Ryot
translates "Read Status" in the following manner:

- to-read -> Watchlist

---

1. Login to your account and click on your profile and go to the "Manage Account"
  page.
2. Scroll to the bottom and click on "Export StoryGraph Library" and then
  "Generate export".
3. Once the export is done, you will receive an email. refresh the page above and
  download the CSV file.
4. Optionally, you can edit the CSV file and manually add the missing ISBN.
5. Upload this file in the input.

## Strong App

You can import your completed workouts from [Strong](https://www.strong.app/) app. If an
exercise does not exist in your instance, it will be created. You can later use the "Edit
Exercise" or "Merge Exercise" actions to map the exercise to an existing one.

1. Login to your Strong account on the app and go to the "Settings" page.
2. Scroll down to the "General" section and click on "Export data".
3. Upload the csv file in the input.

## Hevy

You can import your workouts from [Hevy](https://www.hevy.com). Exercises will be created
using the same strategy as the [Strong app](#strong-app) importer.

1. Login to your Hevy account on the app and go to the "Profile" page.
2. Click on the cog icon on the top right and select "Export & Import Data" under
  "Preferences".
3. Click on "Export" and then click on the button that says "Export Workouts".
4. Upload the csv file in the input.

## IMDb

You can import your watchlist from [IMDb](https://www.imdb.com). They will be added to
the "Watchlist" collection.

1. Go to your account and select your watchlist.
2. Go the bottom and click on the "Export this list" button.
3. Upload the csv file in the input.

## IGDb

You can import your lists from [IGDb](https://www.igdb.com). Each list has to be imported
separately. A few points to note:

- Importing into the "In Progress" collection will set 5% progress for the items.
- Importing into the "Completed" collection will set 100% progress for the items.
- Import into any other collection will just add the items to the collection.

---

1. Login to your account and go to your profile. The default activity lists can be exported
  from  here. Click on the list you want to export and download it as CSV.
2. For your custom lists, please visit the "My Lists" page.
3. Upload the CSV file and choose the collection you want to import into.

## TV Time

::: warning
This is a community maintained integration.
:::

All shows can be imported from [TvTime](https://tvtime.com/) at the moment using an external
tool. You can find all the necessary steps [here](https://github.com/SirMartin/TvTimeToRyot).

## Open Scale

You can import your measurements from [Open Scale](https://github.com/oliexdev/openScale)
app.

This can be done by clicking on the three dots on the top right corner of the app, and then
clicking on "Export". This will save a CSV file to your file system. Upload this file in
the input.
