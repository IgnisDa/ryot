# Radarr

**Trigger:** item added to a selected collection.

1. Get the API key from Radarr general settings.
2. Open browser developer tools at the **Network** tab. Use these Radarr pages to find values in
   the listed responses:

   ```txt
   Profile ID: Settings > Profiles (`/qualityProfile`)
   Root Folder: Settings > Media Management (`/rootFolder`)
   Tags: Settings > Tags (`/tag`)
   ```

3. Under **Settings > Integrations**, create a Radarr integration and select the Ryot collections
   that will send items to Radarr.
