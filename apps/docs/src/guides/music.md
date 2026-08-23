# Music

Spotify metadata requires a client ID and client secret.

1. Create a [Spotify](https://spotify.com) account.
2. Open the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and create an
   app. Its website and redirect URI can be any valid URLs; Ryot does not use the redirect URI.
3. Accept the Spotify terms and create the app.
4. Copy its client ID and client secret.
5. Set:

   ```bash
   RYOT_PLUGIN_MEDIA_SPOTIFY_CLIENT_ID=your-client-id
   RYOT_PLUGIN_MEDIA_SPOTIFY_CLIENT_SECRET=your-client-secret
   ```
