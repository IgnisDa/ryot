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
- Enter the correct details in the inputs.

## Goodreads

All [Goodreads](https://www.goodreads.com) shelves are converted into
"Collections" in Ryot.

### Steps

- Login to your Goodreads account and click on "My Books" on the topbar.
- Select "Import and export" under the "Tools" section on the left.
- Click on the "Export" button and wait for some time.
- When ready download the CSV export.
- Upload it to the given input.
