# Komga

The [Komga](https://komga.org) integration can sync all media if they have a valid
metadata provider. If you use [Komf](https://github.com/Snd-R/komf) or some similar
metadata provider these urls will be populated automatically. If you don't, you will either
need to manually add the manga to your collection or you can perform the following steps.

1. Navigate to the manga and open the Edit tab
2. Navigate to the Links tab
3. Create a link named `AniList` or `MyAnimeList` providing the respective url (not
   case-sensitive)
4. On Ryot, create an integration and select Komga as the source
5. Provide your Base URL. It should look something like this `https://komga.acme.com` or
   `http://127.0.0.1:25600`
6. Provide your Username and Password.
7. Provide your preferred metadata provider. Ryot will attempt the others if the preferred
   is unavailable and will fallback to title search otherwise.
