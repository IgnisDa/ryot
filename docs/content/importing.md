# Importing

Importing is meant to be a one-time operation. They are irreversible, i.e., importing from
the same source twice will create duplicates. I recommend you to make a database backup
before starting an import.

An import can fail at various steps. Ryot creates a report when an import completes/fails.
You can see the reports under "Import History" of the imports page.

## Notes

- Imports are very difficult to have 100% success rate. Though we try our best,
  you might have to manually import some data from your previous provider.
- I recommend turning on debug logging for the duration of the import using the
  `RUST_LOG=ryot=debug` environment variable. This will help you help you see import
  progress in the docker logs.

## Jellyfin

You can import your watched movies and shows from [Jellyfin](https://jellyfin.org).

!!! warning

      This will only import media that are already finished. Setup an
      [integration](./integrations.md#jellyfin) if you want to import media in progress.

Enter the correct details in the input. The username you enter should be of the account
whose data you want to import.

## Plex

You can import your watched movies and shows from [Plex](https://plex.tv).

!!! warning

      This will only import media that are already finished. Setup an
      [integration](./integrations.md#plex) if you want to import media in progress.

### Steps

- Obtain a `Plex-Token` as described [here](https://www.plexopedia.com/plex-media-server/general/plex-token/#getcurrentusertoken).
- Enter the correct details in the inputs.

## Trakt

All movies and shows can be imported from [Trakt](https://trakt.tv) along with
their ratings, history, comments and lists. A few points to note.

- It is necessary to set your account's privacy to public during the
  duration of the import. The Trakt authentication flow is pretty complicated
  and I don't think it would be worth implementing.
- Items that have been "check(ed) in" will not be imported.

### Steps

- Login to your Trakt account and go to the settings page.
- If your account is set to private, uncheck the box next to it. You can revert
  this change once the import is complete.
- If you have any lists that are private, you need to change them to public.
  Otherwise they will not be imported.
- Find your profile slug. This is usually your username. You can find it by
  going to your profile page, and checking the URL.
- Enter this username in the input.

## Audiobookshelf

The Audiobookshelf importer supports importing all media that have a valid Audible ID or
ITunes ID or ISBN.

!!! warning

    - This will only import media that are already finished. Setup an
      [integration](./integrations.md#audiobookshelf) if you want to import media in progress.
    - If you have enabled the option to auto delete podcast episodes, you'll have to
      manually mark them as completed.

### Steps

- Obtain an API token as described in the Audiobookshelf
  [authentication](https://api.audiobookshelf.org/#authentication) docs.
- Enter the correct details in the input.

## Goodreads

Ryot translates [Goodreads](https://www.goodreads.com/) shelves in the
following manner:

- Want To Read -> Watchlist

### Steps

- Login to your Goodreads account and go to the "My Books" section.
- Click on "Import and export" on the left sidebar.
- Click on "Export Library" and download the CSV file.
- Upload this file in the input.

## MediaTracker

You can import from [MediaTracker](https://github.com/bonukai/MediaTracker), with
the following caveats:

- Items that are in progress are always imported with 100% progress. They are
  added to the "In Progress" collection so you can manually fix their progress
  if needed.

### Steps

- Login to your MediaTracker account and click on your name on the top right.
- Click on the "Application tokens" section.
- Enter a name and click on "Add token".
- Copy the token that was just generated.
- Enter the details in the inputs.

## Generic Json

The "Generic Json" can be used to import all possible data from a generic JSON file. The
format of the JSON file should be `CompleteExport` as described in the
[exporting](guides/exporting.md#type-definitions) documentation.

You can use this to export all your data from one Ryot instance and import it into another,
or from a source that is not supported by Ryot.

## Movary

The Watchlist and all movies can be imported from [Movary](https://movary.org)
along with ratings, history, and comments.

### Steps

- Login to your Movary account and go to the settings page. Go to "Personal data"
  under the "Account" section.
- Export "history.csv", "watchlist.csv" and "ratings.csv".
- Upload these files in the input.

## MyAnimeList

Manga and Anime can be imported from [MyAnimeList](https://myanimelist.net)
along with ratings, history and progress.

### Steps

- Login to your MyAnimeList account and go to
  [exports](http://myanimelist.net/panel.php?go=export).
- Export your anime and manga history.
- Upload these files in the input.

## StoryGraph

Imports from [StoryGraph](https://thestorygraph.com) work using ISBN. All books
in your export that have an ISBN attached to them will be imported. Ryot
translates "Read Status" in the following manner:

- to-read -> Watchlist

### Steps

- Login to your account and click on your profile and go to the "Manage Account"
  page.
- Scroll to the bottom and click on "Export StoryGraph Library" and then
  "Generate export".
- Once the export is done, you will receive an email. refresh the page above and
  download the CSV file.
- Optionally, you can edit the CSV file and manually add the missing ISBN.
- Upload this file in the input.

## Strong App

You can import your completed workouts from [Strong](https://www.strong.app/) app. If an
exercise does not exist in your instance, it will be created with a unique identifier. You
can later use the "Edit Exercise" or "Merge Exercise" actions to map the exercise to an
existing one.

### Steps

- Login to your Strong account on the app and go to the "Settings" page.
- Scroll down to the "General" section and click on "Export data".
- Upload the csv file in the input.

## IMDb

You can import your watchlist from [IMDb](https://www.imdb.com). They will be added to
the "Watchlist" collection.

### Steps

- Go to your account and select your watchlist.
- Go the bottom and click on the "Export this list" button.
- Upload the csv file in the input.

## IGDb

You can import your lists from [IGDb](https://www.igdb.com). Each list has to be imported
separately. A few points to note:

- Importing into the "In Progress" collection will set 5% progress for the items.
- Importing into the "Completed" collection will set 100% progress for the items.
- Import into any other collection will just add the items to the collection.

### Steps

- Login to your account and go to your profile. The default activity lists can be exported
  from  here. Click on the list you want to export and download it as CSV.
- For your custom lists, please visit the "My Lists" page.
- Upload the CSV file and choose the collection you want to import into.

## TV Time

!!! warning

      This is a community maintained integration.

All shows can be imported from [TvTime](https://tvtime.com/) at the moment using an external
tool. You can find all the necessary steps [here](https://github.com/SirMartin/TvTimeToRyot).

## Open Scale

You can import your measurements from [Open Scale](https://github.com/oliexdev/openScale)
app.

This can be done by clicking on the three dots on the top right corner of the app, and then
clicking on "Export". This will save a CSV file to your file system. Upload this file in
the input.
