# Movies and shows

Ryot supports tracking movies and shows via [TMDB](https://www.themoviedb.org/). To enable
this functionality, you need to obtain an access token from TMDB.

## Getting TMDB access token

You can follow the below steps to obtain your own access token and enable movie and show
tracking.

### Steps

1. Create a [TMDB](https://www.themoviedb.org/) account.
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
