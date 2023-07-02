# Integrations

Integrations can be of two types:

- _Yank_: The data is downloaded from an external running server.
- _Sink_: The external client publishes data updates to the Ryot server.

## Yank

Credentials for the external server must be saved to your profile.

### Audiobookshelf

// TODO: Complete it

## Sink

To start, go to the "Settings" tab and generate a new application token from under
the "Tokens" tab. It will look like this: `e96fca00-18b1-467c-80f0-8534e09ed790`.

### Kodi

The [Kodi](https://kodi.tv/) integration allows syncing the current movie or TV
show you are watching. It will work for all the media that have been a valid
TMDb ID attached to their metadata.

#### Steps

- Download the addon from [github releases](https://github.com/IgnisDa/ryot/releases).
The file will have a name of `script.ryot.zip`.
- [Install](https://kodi.wiki/view/Add-on_manager#How_to_install_from_a_ZIP_file)
the zipped addon to your Kodi instance. Once installed, it will be visible under
the "Services" sub category named "Ryot".
- Click on "Configure" to change the addon settings and fill the correct details.

Your integration should now start working!
