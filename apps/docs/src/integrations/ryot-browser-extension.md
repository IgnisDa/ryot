<script setup>
import variables from "../variables";
</script>

# Ryot Browser Extension <Badge type="warning" text="PRO" />

::: tip
The extension is in beta and can fail on some sites. Report problems on GitHub.
:::

The extension extracts media details from many video-streaming sites and sends progress to Ryot.

1. Download an archive from <a
   :href="`${variables.repoUrl}/releases`" target="_blank">GitHub releases</a>:
   - **Chrome/Edge/Brave**: Download `ryotbrowser-extension-*-chrome.zip`
   - **Firefox**: Download `ryotbrowser-extension-*-firefox.zip`
2. For Chrome, Edge, or Brave, extract the archive. At `chrome://extensions/`, enable developer
   mode and load the unpacked folder.
3. For Firefox, at `about:debugging`, select **This Firefox > Load Temporary Add-on** and choose
   the ZIP file.
4. Under **Settings > Integrations**, create a Ryot Browser Extension integration. Copy its
   webhook URL, which ends with `/_i/{integrationId}`.
5. Open the extension and enter the webhook URL.
