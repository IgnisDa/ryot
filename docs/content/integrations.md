# Integrations

Integrations can be used to continuously update your media progress. They can
be of two types:

- _Yank_: Progress data is downloaded from an externally running server at a
periodic interval.
- _Sink_: An external client publishes progress updates to the Ryot server.

!!! info

    An item is marked as started when it has more than _2%_ progress and
    marked as completed when it has more than _95%_ progress.

!!! warning

    Keep your webhook urls private to prevent abuse.

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

To start, go to the "Settings" tab and generate a new application token from under
the "Tokens" tab. It will look like this: `rab88f6b10`.

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

### Kodi

The [Kodi](https://kodi.tv/) integration allows syncing the current movie or TV
show you are watching. It will work for all the media that have been a valid
TMDb ID attached to their metadata.

1. Download the addon from [github releases]({{ config.repo_url }}/releases).
    The file will have a name of `script.ryot.zip`.
2. [Install](https://kodi.wiki/view/Add-on_manager#How_to_install_from_a_ZIP_file)
    the zipped addon to your Kodi instance. Once installed, it will be visible under
    the "Services" sub category named "Ryot".
3. Click on "Configure" to change the addon settings and fill the correct details.

### Plex

Automatically add new [Plex](https://www.plex.tv/) movie plays to Ryot. It will
work for all the media that have been a valid TMDb ID attached to their metadata.

1. Generate a slug in the integration settings page. Copy the newly generated
    slug.
2. In your Plex Webhooks settings, add a new webhook using the
    following settings:
    - Webhook Url => `<instance_url>/webhooks/integrations/plex/<slug>`
