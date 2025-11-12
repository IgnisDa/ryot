# Movies and Shows

Ryot supports tracking movies and shows via [TMDB](https://www.themoviedb.org) and
[TVDB](https://www.thetvdb.com). You can enable either TMDB, TVDB, or both.

## TMDB

1. Create a [TMDB](https://www.themoviedb.org) account.
2. Go to your [account settings](https://www.themoviedb.org/settings/account).
3. Click on the "API" section in the left sidebar.
4. Click on "click here" under "Request an API Key".
5. Fill out the application form. You can use your personal information to fill details.
   The application URL can be any URL since this is for personal use.
6. Accept the terms of use and submit the application.
7. Once approved, you will see your API details. Copy the **API Read Access Token** (not
   the API key).
8. Set the `MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN` environment variable as described in the
   [configuration](../configuration.md#important-parameters) docs.

## TVDB

- Create a [TVDB](https://www.thetvdb.com) account.
- Visit the [API](https://www.thetvdb.com/api-information) page and then click on "Get
  Started".
- Follow the prompts and then copy your **API Key**.
- Set the `MOVIES_AND_SHOWS_TVDB_API_KEY` environment variable as described in the
  [configuration](../configuration.md#all-parameters) docs.
