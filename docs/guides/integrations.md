# Integrations

Integrations can be used to continuosly updated your media progress. They can
be of two types:

- _Yank_: Progress data is downloaded from an externally running server at a
periodic interval.
- _Sink_: An external client publishes progress updates to the Ryot server.

## Yank plugins

For each integration you want to enable, credentials for the external server
must be saved to your profile. To do so, go to the "Settings" tab and add a
new integration under the "Integrations" tab.

**NOTE**: An item is marked as started when it has more than _2%_ progress and
marked as completed when it has more than _95%_ progress.

- ### Audiobookshelf

  The [Audiobookshelf](https://www.audiobookshelf.org) integration can sync all
  media which have a match from _Audible_.

  1. Obtain an API token as described in the Audiobookshelf
  [authentication](https://api.audiobookshelf.org/#authentication) docs.
  2. Go to your Ryot user settings and add the correct details as described in the
  [yank](#yank-plugins) section.

## Sink plugins

To start, go to the "Settings" tab and generate a new application token from under
the "Tokens" tab. It will look like this: `e96fca00-18b1-467c-80f0-8534e09ed790`.

- ### Kodi

  The [Kodi](https://kodi.tv/) integration allows syncing the current movie or TV
  show you are watching. It will work for all the media that have been a valid
  TMDb ID attached to their metadata.

  1. Download the addon from [github releases](https://github.com/IgnisDa/ryot/releases).
  The file will have a name of `script.ryot.zip`.
  2. [Install](https://kodi.wiki/view/Add-on_manager#How_to_install_from_a_ZIP_file)
  the zipped addon to your Kodi instance. Once installed, it will be visible under
  the "Services" sub category named "Ryot".
  3. Click on "Configure" to change the addon settings and fill the correct details.
