# Trakt

Ryot supports importing data from [Trakt](https://trakt.tv). The User and List imports use
the Trakt API and require a client ID. The Export ZIP import does not require a Trakt client ID.

## Getting Trakt client ID

You can follow the below steps to obtain your own client ID and enable User and List API imports.

### Steps

1. Create a [Trakt](https://trakt.tv) account.
2. Go to [Your API Apps](https://trakt.tv/oauth/applications) in your account settings.
3. Click on "New Application".
4. Fill out the application form. Here are some explanations for the fields:
   - **Name**: Give your application a name (e.g., "Ryot Personal")
   - **Redirect URI**: This can be any valid URL (e.g., `https://github.com`). It is
     not used by Ryot.
5. Click "Save App".
6. Once created, you will see your application details. Copy the **Client ID**.
7. Set the `SERVER_IMPORTER_TRAKT_CLIENT_ID` environment variable as described in the
   [configuration](../configuration.md#important-parameters) docs to enable User and List API imports.
