# Trakt

Trakt User and List imports require a client ID. Export ZIP imports do not.

1. Create a [Trakt](https://trakt.tv) account.
2. Go to [Your API Apps](https://trakt.tv/oauth/applications) in your account settings.
3. Create an application. The redirect URI can be any valid URL; Ryot does not use it.
4. Save the application and copy its client ID.
5. Set `RYOT_PLUGIN_MEDIA_TRAKT_CLIENT_ID`.
