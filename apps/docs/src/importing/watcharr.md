# Watcharr

::: info
It is necessary to setup TMDB for this import to work. Please follow the configuration
[guide](../configuration.md) for instructions.
:::

You can import your watched movies and shows from [Watcharr](https://github.com/sbondCo/Watcharr).

## Exporting from Watcharr

1. Log into your Watcharr instance.
2. Navigate to the Profile page and scroll to the bottom.
3. Click "Export" to download your data as a JSON file.

## Importing into Ryot

1. Upload the exported JSON file in the Ryot import page.
2. Select "Watcharr" as the import source.
3. Choose the JSON file you exported from Watcharr.
4. Click "Import" to start the import process.

## What gets imported

- **Movies and TV Shows**: All your watched content with TMDB IDs
- **Watch History**: Episode-level tracking for TV shows, watch dates for movies
- **Ratings**: Your ratings are converted from Watcharr's 0-10 scale to Ryot's 0-100 scale
- **Reviews**: Any thoughts/notes you added to items
- **Collections**:
  - Items marked as "Planned" are added to your Watchlist
  - Items marked as "Dropped" are added to a "Dropped" collection
  - Pinned items are added to a "Pinned" collection
- **Status**: Watch status (Finished, Watching, Planned, Dropped) is preserved
