# Books

[Open Library](https://openlibrary.org) is the default book provider. Configure another provider
if it does not contain the books you need.

## Hardcover

Hardcover API keys expire after one year or on January 1. Renew the key when required.

1. Create a [Hardcover](https://hardcover.app) account.
2. Open [API Access](https://hardcover.app/account/api) and copy the authorization header value.
3. Set it as `RYOT_PLUGIN_MEDIA_HARDCOVER_API_KEY`.

## Google Books

1. Open the [Google Cloud Console](https://console.cloud.google.com) and select or create a project.
2. In the [APIs dashboard](https://console.cloud.google.com/apis/dashboard), enable Google Books API.
3. Create an API key under **Credentials**.
4. Set it as `RYOT_PLUGIN_MEDIA_GOOGLE_BOOKS_API_KEY`.
