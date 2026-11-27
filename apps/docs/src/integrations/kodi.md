<script setup>
import variables from "../variables";
</script>

# Kodi

The Kodi add-on syncs the current movie or show when it has a valid TMDB ID.

1. Under **Settings > Integrations**, create a Kodi integration and copy its webhook URL. It ends
   with a random secret token.
2. Download `script.ryot.zip` from <a :href="`${variables.repoUrl}/releases`" target="_blank">GitHub releases</a>.
3. [Install](https://kodi.wiki/view/Add-on_manager#How_to_install_from_a_ZIP_file)
   the ZIP add-on. It appears under **Services** as **Ryot**.
4. Open **Configure** and enter the webhook URL.
