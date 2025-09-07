# Radarr

Events: `Item added to collection`

1. Obtain your Radarr API key by going to the Radarr general settings page.
2. The input values are not apparent, so you will have to inspect the network requests made
   by Radarr to find the correct values. You can do this by opening your browser's
   developer tools, and navigating to the Network tab.

   ```txt
   Profile ID: going to Settings -> Profiles (`/qualityProfile` request)
   Root Folder: going to Settings -> Media Management (`/rootFolder` request)
   Tags: going to Settings -> Tags (`/tag` request)
   ```

   For collections, you can select the Ryot collections you want to be synced with Radarr.

3. Fill the inputs in the integration settings page with the correct details.
