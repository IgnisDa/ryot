# Spotify

::: warning

- Set `RYOT_PLUGIN_MEDIA_SPOTIFY_CLIENT_ID` and `RYOT_PLUGIN_MEDIA_SPOTIFY_CLIENT_SECRET` before
  import. Ryot uses them to fetch track metadata.
- Only the **Extended streaming history** export is supported. The basic **Account data** export
  does not contain every play and is rejected.
  :::

1. Open Spotify's [privacy settings](https://www.spotify.com/account/privacy/) and select
   **Extended streaming history** under **Download your data**. Request nothing else.
2. Confirm the request by email. Spotify can take up to 30 days to prepare the export and emails
   you a download link.
3. Download the ZIP. Do not rename, extract, or modify it.
4. Under **Settings > Import data**, select **Spotify** and upload the ZIP. Ryot reads every
   `Streaming_History_Audio_*.json` and `Streaming_History_Video_*.json` file in the archive.

Ryot records each finished play of a track as a completed song with its play time, matching the
[Spotify integration](../integrations/spotify.md). Plays that Spotify ended for any other reason, such
as skipping the track, are not recorded. Podcast episodes, audiobooks, and video episodes are
skipped. Plays in private sessions are included.

Fetching metadata for thousands of tracks takes a long time. Ryot imports exports of up to
150,000 finished plays, with no single history file larger than 50 MB.

Importing a period that the Spotify integration already synced records those plays twice.
