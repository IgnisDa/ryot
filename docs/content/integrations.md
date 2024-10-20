# Integrations

Integrations can be used to continuously update your media progress or inform external
services about changes. They can be of following types:

- _Yank_: Progress data is downloaded from an externally running server at a periodic
  interval.
- _Sink_: An external client publishes progress updates to the Ryot server.
- _Push_: Ryot sends data to an external service when an event occurs.

## Yank integrations

You can configure the interval at which the data is fetched from the external using the
`integration.sync_every_minutes` configuration key. Defaults to `5` (minutes).

### Audiobookshelf

!!! warning

      This will only import media that are in progress. Perform an
      [import](./importing.md#audiobookshelf) if you want to import media that are finished.

The [Audiobookshelf](https://www.audiobookshelf.org) integration can sync all media if they
have a valid provider ID (Audible, ITunes or ISBN).

1. Obtain an API token as described in the Audiobookshelf
   [authentication](https://api.audiobookshelf.org/#authentication) docs.
2. Go to your Ryot user settings and add the correct details as described in the
   [yank](#yank-integrations) section.

### Komga

The [Komga](https://komga.org/) integration can sync all media if they
have a valid metadata provider.

#### Steps

If you use [Komf](https://github.com/Snd-R/komf) or some similar metadata provider these
urls will be populated automatically. If you don't use komf you will either need to
manually add the manga to your collection or you can perform the following steps.

1. Navigate to the manga
2. Open the edit tab
3. Navigate to the Links tab
4. Create a link named `AniList` or `MyAnimeList` providing the respective url (not case-sensitive)

Then perform these steps on Ryot

1. Create the integration and select Komga as the source
2. Provide your BaseURL. Should look something like this `http://komga.acme.com` or `http://127.0.0.1:25600`
3. Provide your Username and Password.
4. Provide your preferred metadata provider. Ryot will attempt the others if the preferred
   is unavailable and will fallback to title search otherwise.

## Sink integrations

These work via webhooks wherein an external service can inform Ryot about a change. All
webhook URLs follow this format:

```txt
https://<instance_url>/backend/_i/<slug>
https://pro.ryot.io/backend/_i/int_a6cGGXEq6KOI # example
```

!!! warning

    Keep your webhook urls private to prevent abuse.

### Jellyfin

Automatically add new [Jellyin](https://jellyfin.org/) movie and show plays to Ryot. It
will work for all the media that have a valid TMDb ID attached to their metadata.

!!! info

    Requires the
    [unofficial webhook plugin](https://github.com/shemanaev/jellyfin-plugin-webhooks)
    to be installed and active in Jellyfin.

1. Generate a slug in the integration settings page. Copy the newly generated
   webhook Url.
2. In the Jellyfin webhook plugin settings, add a new webhook using the
   following settings:
    - Webhook Url => `<paste_url_copied>`
    - Payload format => `Default`
    - Listen to events only for => Choose your user
    - Events => `Play`, `Pause`, `Resume`, `Stop` and `Progress`

### Emby

Automatically add new [Emby](https://emby.media/) movie and show plays to Ryot. It
will work for all the media that have a valid TMDb ID attached to their metadata.

1. Generate a slug in the integration settings page. Copy the newly generated
   webhook Url.
2. In the Emby notification settings page, add a new notification using the
   Webhooks option:
    - Name => `ryot`
    - Url => `<paste_url_copied>`
    - Request Content Type => `application/json`
    - Events => `Play`, `Pause`, `Resume`, `Stop` and `Progress`
    - Limit user events to => Choose your user

!!! warning

    Since Emby does not send the expected TMDb ID for shows, progress will only be synced
    if you already have the show in the Ryot database. To do this, simply add the show to
    your watchlist.

### Plex

Automatically add [Plex](https://www.plex.tv/) show and movie plays to Ryot. It will
work for all the media that have a valid TMDb ID attached to their metadata.

1. Generate a slug in the integration settings page using the following settings:
    - Username => Your Plex `Fullname`. If you have no `Fullname` specified in Plex,
       fallback to your Plex `Username`. This will be used to filter webhooks for the
       specified Plex account only.
2. In your Plex Webhooks settings, add a new webhook using the following settings:
    - Webhook Url => `<paste_url_copied>`

!!! warning

    Since Plex does not send the expected TMDb ID for shows, progress will only be synced
    if you already have the show in the Ryot database. To do this, simply add the show to
    your watchlist.

### Kodi

The [Kodi](https://kodi.tv/) integration allows syncing the current movie or TV
show you are watching. It will work for all the media that have a valid
TMDb ID attached to their metadata.

1. Generate a slug in the integration settings page. Copy the newly generated
   webhook Url.
2. Download the addon from [github releases]({{ config.repo_url }}/releases).
   The file will have a name of `script.ryot.zip`.
3. [Install](https://kodi.wiki/view/Add-on_manager#How_to_install_from_a_ZIP_file)
   the zipped addon to your Kodi instance. Once installed, it will be visible under
   the "Services" sub category named "Ryot".
4. Click on "Configure" to fill in the correct details.

### Generic Json

The "Generic Json" can be used to import all possible data using a generic JSON data
format. The format of the JSON file should be `CompleteExport` as described in the
[exporting](guides/exporting.md#type-definition) documentation.

You can use this to build integrations with other services that Ryot does not support
natively.

## Push integrations

You can enable the following push integrations:

### Radarr

Automatically add movies in the selected collections to Radarr.

1. Obtain your Radarr API key by going to the Radarr general settings page.
2. Fill the inputs in the integration settings page with the correct details.

### Sonarr

Automatically add shows in the selected collections to Sonarr.

1. Obtain your Sonarr API key by going to the Sonarr general settings page.
2. Fill the inputs in the integration settings page with the correct details.

### Jellyfin

Automatically mark movies and shows as watched in Jellyfin when you mark them as watched
in Ryot.

1. While creating the integration, you will be asked to provide your Jellyfin username and
   password.
2. Every time you mark a movie or show as watched in Ryot, the integration will mark it as
   watched in Jellyfin.
