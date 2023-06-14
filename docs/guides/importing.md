# Importing

Ryot supports importing media from a number of sources. Here are a few pointers.

To start importing, go to the settings page and select the "Import" tab.

## MediaTracker

The [MediaTracker](https://github.com/bonukai/MediaTracker) API is pretty
primitive and as a result the following things can not be imported.

- Items in progress
- Lists
- Calendar

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
