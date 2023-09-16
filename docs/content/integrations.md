# Integrations

Integrations can be used to continuously update your media progress. They can
be of two types:

- _Yank_: Progress data is downloaded from an externally running server at a
  periodic interval.
- _Sink_: An external client publishes progress updates to the Ryot server.

!!! info

    An item is marked as started when it has more than _2%_ progress and
    marked as completed when it has more than _95%_ progress.

## Yank plugins

For each integration you want to enable, credentials for the external server
must be saved to your profile. To do so, go to the "Settings" tab and add a
new integration under the "Integrations" tab.

### Audiobookshelf

The [Audiobookshelf](https://www.audiobookshelf.org) integration can sync all
media which have a match from _Audible_.

1. Obtain an API token as described in the Audiobookshelf
   [authentication](https://api.audiobookshelf.org/#authentication) docs.
2. Go to your Ryot user settings and add the correct details as described in the
   [yank](#yank-plugins) section.

## Sink plugins

!!! warning

    Keep your webhook urls private to prevent abuse.

### Jellyfin

Automatically add new [Jellyin](https://jellyfin.org/) movie and show plays to
Ryot. It will work for all the media that have been a valid TMDb ID attached
to their metadata.

!!! info

    Requires the
    [unofficial webhook plugin](https://github.com/shemanaev/jellyfin-plugin-webhooks)
    to be installed and active in Jellyfin.

1. Generate a slug in the integration settings page. Copy the newly generated
   slug.
2. In the Jellyfin webhook plugin settings, add a new webhook using the
   following settings:
   - Webhook Url => `<instance_url>/webhooks/integrations/jellyfin/<slug>`
   - Payload format => `Default`
   - Listen to events only for => Choose your user
   - Events => `Play`, `Pause`, `Resume`, `Stop` and `Progress`

### Plex

Automatically add [Plex](https://www.plex.tv/) show and movie plays to Ryot. It will
work for all the media that have been a valid TMDb ID attached to their metadata.

1. Generate a slug in the integration settings page using the following settings:
    - Username => Your Plex `Fullname`. If you have no `Fullname` specified in Plex,
     fallback to your Plex `Username`. This will be used to filter webhooks for the
     specified Plex account only
2. In your Plex Webhooks settings, add a new webhook using the
   following settings:
   - Webhook Url => `<instance_url>/webhooks/integrations/plex/<slug>`

!!! warning

   Since Plex does not send the expected TMDb ID for shows, progress will only be synced
   if you already have the show in the Ryot database. To do this, simply add the show to
   your Ryot watchlist.

### Kodi

The [Kodi](https://kodi.tv/) integration allows syncing the current movie or TV
show you are watching. It will work for all the media that have been a valid
TMDb ID attached to their metadata.

1. Generate a slug in the integration settings page. Copy the newly generated
   slug.
2. Download the addon from [github releases]({{ config.repo_url }}/releases).
   The file will have a name of `script.ryot.zip`.
3. [Install](https://kodi.wiki/view/Add-on_manager#How_to_install_from_a_ZIP_file)
   the zipped addon to your Kodi instance. Once installed, it will be visible under
   the "Services" sub category named "Ryot".
4. Click on "Configure" to change the addon settings and fill the correct details.
