# Komga

The [Komga](https://komga.org) integration can sync all media if they have a valid
metadata provider. If you use [Komf](https://github.com/Snd-R/komf) or some similar
metadata provider these urls will be populated automatically. If you don't, you will either
need to manually add the manga to your collection or you can perform the following steps.

1. Navigate to the series and open the Edit tab
2. Navigate to the Links tab
3. Create a link with one of the following names (not case-sensitive):
   - `AniList` - for manga from AniList
   - `MyAnimeList` - for manga from MyAnimeList
   - `MangaUpdates` - for manga from MangaUpdates
   - `OpenLibrary` - for books from Open Library
   - `GoogleBooks` or `Google Books` - for books from Google Books
   - `Hardcover` - for books from Hardcover
4. On Ryot, create an integration and select Komga as the source
5. Provide your Base URL. It should look something like this `https://komga.acme.com` or
   `http://127.0.0.1:25600`
6. Provide your API Key. You can generate one in Komga under User Settings > API Keys.
