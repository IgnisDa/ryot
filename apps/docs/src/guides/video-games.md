# Video games

A guide about video games integration for Ryot.

## Integration with IGDB

Ryot supports tracking video games via [IGDB](https://www.igdb.com/). However, the API is
heavily rate limited, so it is not possible to hardcode the API keys in the application
(unlike the others).

You can follow the below steps to obtain your own API keys and enable video game tracking.

### Steps

1. Create a [Twitch](https://twitch.tv) account.
2. Open your [developer console](https://dev.twitch.tv/console).
3. Click on "Register Your Application" on the dashboard.
4. Fill up the details. Any name will suffice but it must be unique. Click on "Create"
   when you are done.
5. You will be guided back to your application dashboard. Click on "Manage" for
   the application you just created.
6. Generate a client secret. Copy the **Client ID** and **Client Secret**.
7. Set the `VIDEO_GAMES_*` environment variables as described in the
   [configuration](../configuration.md#important-parameters) docs.

## Integration with GiantBomb

Ryot also supports tracking video games via [GiantBomb](https://www.giantbomb.com/). This
provides an alternative source for video game metadata with comprehensive coverage.

### Steps

1. Create a [GiantBomb](https://www.giantbomb.com/) account.
2. Navigate to your [API key page](https://www.giantbomb.com/api/).
3. Generate an API key if you don't have one already.
4. Copy the **API Key**.
5. Set the `VIDEO_GAMES_GIANTBOMB_API_KEY` environment variable with your API key.
