<script setup>
import variables from "../variables";
</script>

# Ryot Browser Extension <Badge type="warning" text="PRO" />

::: tip
This extension is currently in beta and may not work perfectly on all sites. If you
encounter any issues, please report them on the issue tracker on GitHub.
:::

The Ryot Browser Extension can automatically scrobble media that you are watching on
various streaming services. It works on most video streaming sites and will automatically
extract media information to sync with Ryot.

1. Download the appropriate extension for your browser from <a
   :href="`${variables.repoUrl}/releases`" target="_blank">GitHub releases</a>:
   - **Chrome/Edge/Brave**: Download `ryotbrowser-extension-*-chrome.zip`
   - **Firefox**: Download `ryotbrowser-extension-*-firefox.zip`
2. Install the extension:
   - **Chrome/Edge/Brave**: Go to `chrome://extensions/`, enable "Developer mode", click
     "Load unpacked", and select the extracted folder
   - **Firefox**: Go to `about:debugging`, click "This Firefox", click "Load Temporary
     Add-on", and select the zip file
3. Generate a slug in the integration settings page and copy the newly generated webhook URL.
4. Configure the extension:
   - Click on the extension icon in your browser toolbar
   - Enter your webhook URL
