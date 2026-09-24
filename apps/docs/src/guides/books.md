# Books

The default provider that Ryot uses for book tracking is
[Openlibrary](https://openlibrary.org). You might find it lacking in some cases, so Ryot
also supports other providers.

## Hardcover

Ryot supports tracking books via [Hardcover](https://hardcover.app). As of writing, the
API key expires after a year or on January 1st, so you will need to renew it accordingly.

You can use the following steps to obtain your own API keys:

1. Create a [Hardcover](https://hardcover.app) account.
2. Open [API Access](https://hardcover.app/account/api) and create an API key using the `Read-Only Stats / Export` preset.
3. Set it as `RYOT_PLUGIN_MEDIA_HARDCOVER_API_KEY`.

## Google Books

Ryot also supports tracking books via [Google Books](https://books.google.com). You can
follow the below steps to obtain your own API keys and enable book tracking with Google
Books.

1. Create a [Google Cloud Platform](https://cloud.google.com) account. Open your [Google
   Cloud Platform Console](https://console.cloud.google.com).
2. Use the default project or click on "Create a project" on the dashboard.
3. Open the [APIs & Services Dashboard](https://console.cloud.google.com/apis/dashboard).
4. Click on "Enable APIs and Services". Search for "Google Books API" and click on
   "Enable".
5. Click on "Credentials" on the left sidebar. Click on "Create Credentials" and select
   "API key".
6. Click on "Create" and copy the API key.
7. Set the `BOOKS_GOOGLE_BOOKS_API_KEY` environment variable as described in the
   [configuration](../configuration.md) docs.
