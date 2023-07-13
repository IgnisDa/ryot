# Importing

Importing is meant to be a one-time operation. They are irreversible. Ryot
supports importing media from a number of sources. To start importing, go to
the settings page and select the "Imports" tab.

## MediaTracker

You can import from [MediaTracker](https://github.com/bonukai/MediaTracker), with
the following caveats:

- Items that are in progress are always imported with 100% progress. They are
  added to the "In Progress" collection so you can manually fix their progress
  if needed.
- Ryot does not support calendars yet

### Steps

- Login to your MediaTracker account and click on your name on the top right.
- Click on the "Application tokens" section.
- Enter a name and click on "Add token".
- Copy the token that was just generated.
- Enter the details in the inputs.

## Goodreads

Ryot translates Goodreads shelves in the following manner:

- Want To Read -> Watchlist

### Steps

- Login to your Goodreads account and go to the "My Books" section.
- Right click on the RSS Link on the bottom right of the screen and copy it.

  ![RSS URL image](/docs/assets/goodreads-rss-url.png)

- Enter this URL in the input.

## Trakt

All movies and shows can be imported from [Trakt](https://trakt.tv) along with
their ratings, history, comments and lists. A few points to note.

- It is necessary to set your account's privacy to public during the
  duration of the import. The Trakt authentication flow is pretty complicated
  and I don't think it would be worth implementing.
- Items that have been "check(ed) in" will not be imported.

## Movary

All movies can be imported from [Movary](https://movary.org) along with
their ratings, history, and comments.
  
### Steps

- Login to your Movary account and go to the settings page. Go to "Personal data"
  under the "Account" section.
- Export "history.csv" and "ratings.csv".
- Upload these files in the input.

## Notes

- Imports are very difficult to have 100% success rate. Though we try our best,
  you might have to manually import some data from your previous provider.
- Ryot creates a report when an import is complete, but does not provide a UI
  to view this information ([yet](https://github.com/IgnisDa/ryot/issues/27)).
  Once an import is complete, you can run the following SQL query in the connected
  database to get more information about which items failed and why.

  ```sql
  SELECT * FROM media_import_report;
  ```
