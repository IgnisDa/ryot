# Books

A guide about books integration for Ryot.

## Integration with Google Books

Ryot also supports tracking books via [Google Books](https://books.google.com). However,
the API is heavily rate limited, so it is not possible to hardcode the API keys in the
application (unlike the others).

You can follow the below steps to obtain your own API keys and enable book tracking with
Google Books.

### Steps

1. Create a [Google Cloud Platform](https://cloud.google.com) account. Open your [Google
   Cloud Platform Console](https://console.cloud.google.com).

2. Use the default project or click on "Create a project" on the dashboard.

3. Open the [APIs & Services Dashboard](https://console.cloud.google.com/apis/dashboard).

4. Click on "Enable APIs and Services". Search for "Google Books API" and click on
   "Enable".

5. Click on "Credentials" on the left sidebar. Click on "Create Credentials" and select
   "API key".

6.  Click on "Create" and copy the API key.

7. Set the `BOOKS_GOOGLE_BOOKS_API_KEY` environment variable as described in the
   [configuration](../configuration.md) docs.
