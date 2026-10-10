# Watcharr

::: info
Set `RYOT_PLUGIN_MEDIA_TMDB_ACCESS_TOKEN` before import.
:::

1. Log in to [Watcharr](https://github.com/sbondCo/Watcharr).
2. At the bottom of **Profile**, select **Export** to download JSON.
3. Under **Settings > Import data**, select **Watcharr** and upload the JSON file.

## What gets imported

| Source data                    | Ryot result                  |
| ------------------------------ | ---------------------------- |
| Movies and shows with TMDB IDs | Imported                     |
| Show history                   | Episode-level history        |
| Movie history                  | Watch dates                  |
| Ratings                        | Converted from 0-10 to 0-100 |
| Thoughts and notes             | Reviews                      |
| `Planned`                      | `Watchlist`                  |
| `Dropped`                      | New `Dropped` collection     |
| Pinned                         | New `Pinned` collection      |

Finished, Watching, Planned, and Dropped status is preserved.
