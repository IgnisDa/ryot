# Importing

Importing is meant to be a one-time operation. They are irreversible. Ryot
supports importing media from a number of sources. I recommend you make a database backup
before starting an import. To start, click on "Imports and Exports" link under the
"Settings" section in the sidebar.

An import can fail at various steps. Ryot creates a report when an import completes/fails.
You can go to the reports page by clicking on "Reports" link on the imports page.

## Notes

- Imports are very difficult to have 100% success rate. Though we try our best,
  you might have to manually import some data from your previous provider.
- You can see the descriptions of the failing importing steps by reviewing the
  documentation of the `ImportFailStep` enum in the `/backend/graphql` endpoint.

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

## Generic JSON

This can be used to import data from a generic JSON file. The import format
required is described in the [exporting](guides/exporting.md#type-definition)
documentation.

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

You can import your completed workouts from [Strong](https://www.strong.app/) app. Make sure
you do the import process on a desktop/laptop since the process needs to have multiple tabs
open at once.

There is also an automated script that will be able to migrate most of your data. Please
follow [this](https://gist.github.com/IgnisDa/c21c28dd83571ca07f1a7a824b5e8139?permalink_comment_id=4725066#gistcomment-4725066)
guide.

### Steps

- Login to your Strong account on the app and go to the "Settings" page.
- Scroll down to the "General" section and click on "Export data".
- Send the file to your desktop/laptop and upload it in the input.
- The mapping section is used to map exercises from Strong to Ryot. Each exercise must be
  mapped, otherwise the import will fail.
- If an exercise does not exist in your instance, you need to create it before mapping it.
- Once you have mapped all the exercises, click on "Import".

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

!!! warning

      This will only import media that are already finished. Setup an
      [integration](./integrations.md#audiobookshelf) if you want to import media in progress.

!!! warning

      The Audiobookshelf importer supports only audio books. If also need to import
      podcasts, please open an issue and wait till podcast support is added.

### Steps

- Obtain an API token as described in the Audiobookshelf
  [authentication](https://api.audiobookshelf.org/#authentication) docs.
- Enter the correct details in the input.

## TV Time

!!! warning

      This is a community maintained integration.

All shows can be imported from [TvTime](https://tvtime.com/) at the moment using an external
tool. You can find all the necessary steps [here](https://github.com/SirMartin/TvTimeToRyot).
