# Music

Ryot supports tracking music via [Spotify](https://spotify.com). You can follow the steps
below to obtain your own client ID and secret to enable music tracking with Spotify.

## Getting Spotify client ID and secret

You can follow the below steps to obtain your own API keys and enable music tracking with
Spotify.

1. Create a [Spotify](https://spotify.com) account.
2. Go to the [Spotify for Developers](https://developer.spotify.com) website and log in
   with your Spotify account.
3. Click on "Create an app" or go to your [Dashboard](https://developer.spotify.com/dashboard).
4. Click on "Create an app" and fill out the application form:
   - **App name**: Give your application a name (e.g., "Ryot Personal Music Tracker")
   - **App description**: Provide a brief description (e.g., "Personal music tracking
     for Ryot")
   - **Website**: This can be any valid URL (e.g., `https://github.com` or your Ryot
     instance URL)
   - **Redirect URI**: This can be any valid URL (e.g., `https://github.com`). It is
     not used by Ryot for music tracking.
5. Accept the Spotify Developer Terms of Service and Design Guidelines.
6. Click "Create".
7. Once created, you will be taken to your app's dashboard. Here you will see your
   **Client ID**.
8. Click on "Show Client Secret" to reveal your **Client Secret**.
9. Copy both the **Client ID** and **Client Secret**.
10. Set the environment variables as described in the [configuration](../configuration.md)
    docs:
    ```bash
    MUSIC_SPOTIFY_CLIENT_ID=your_client_id_here
    MUSIC_SPOTIFY_CLIENT_SECRET=your_client_secret_here
    ```
