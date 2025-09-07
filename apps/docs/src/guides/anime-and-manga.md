# Anime and Manga

Ryot supports various providers for tracking anime and manga.

## MyAnimeList

To enable using MyAnimeList as provider, you need to register an application to obtain a
client ID.

1. Create a [MyAnimeList](https://myanimelist.net) account.
2. Go to [API](https://myanimelist.net/apiconfig) in your account preferences.
3. Click on "Create ID".
4. Fill out the application form. Here are some explanations for the fields:
   - **App Name**: Give your application a name (e.g., "Ryot Personal")
   - **App Type**: Select "Web"
   - **App Redirect URL**: This can be any valid URL (e.g., `https://github.com`). It is
     not used by Ryot.
   - **Homepage URL**: This can be any valid website URL. It is not used by Ryot.
5. Once you have filled the form, submit the application.
6. Once approved, you will see your application details. Copy the **Client ID**.
7. Set the `ANIME_AND_MANGA_MAL_CLIENT_ID` environment variable as described in the
   [configuration](../configuration.md#important-parameters) docs.
