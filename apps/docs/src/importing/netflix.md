# Netflix

::: warning

- This importer is in beta. Report problems on GitHub.
- Set `RYOT_PLUGIN_MEDIA_TMDB_ACCESS_TOKEN` before import.
- Only Netflix exports in English are supported. Make sure your account language is set to
  English before requesting the export.
  :::

1. Visit Netflix's [GetMyInfo](https://www.netflix.com/account/getmyinfo) while signed in to
   the profile you want to export.
2. Under **Download your personal information**, request a new archive. Netflix emails you
   when the export is ready (this can take a few hours).
3. Download the archive ZIP. Do not rename, extract, or modify it.
4. Under **Settings > Import data**, select **Netflix** and upload the ZIP. Ryot reads
   `{ViewingActivity,Ratings,MyList}.csv`.
5. Optionally, enter a **Profile Name** to filter the import to a specific Netflix profile.
   If left empty, all profiles from the export will be imported.

Ryot skips supplemental clips and autoplay artifacts. Review unmatched items in the import report.
