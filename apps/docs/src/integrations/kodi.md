<script setup>
import variables from "../variables";
</script>

# Kodi

The [Kodi](https://kodi.tv/) integration allows syncing the current movie or TV
show you are watching. It will work for all the media that have a valid
TMDb ID attached to their metadata.

1. Generate a slug in the integration settings page. Copy the newly generated
   webhook Url.
2. Download the addon from <a :href="`${variables.repoUrl}/releases`" target="_blank">github releases</a>.
   The file will have a name of `script.ryot.zip`.
3. [Install](https://kodi.wiki/view/Add-on_manager#How_to_install_from_a_ZIP_file)
   the zipped addon to your Kodi instance. Once installed, it will be visible under
   the "Services" sub category named "Ryot".
4. Click on "Configure" to fill in the correct details.
