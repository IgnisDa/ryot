# Netflix

::: warning

- This importer is still in beta. Please report any issues you encounter on Github.
- It is necessary to set up TMDB for this import to work. Please follow the configuration
  [guide](../configuration.md) for instructions.
- Only Netflix exports in English are supported. Make sure your account language is set to
  English before requesting the export.
:::

You can import your Netflix watch activity, ratings, and My List entries into Ryot.

1. Visit Netflix's [GetMyInfo](https://www.netflix.com/account/getmyinfo) while signed in to
   the profile you want to export.
2. Under **Download your personal information**, request a new archive. Netflix emails you
   when the export is ready (this can take a few hours).
3. Download the archive ZIP from the email. Leave the file exactly as Netflix provides
   it—do not rename, unzip, or move files out of it.
4. In Ryot, open **Settings → Imports & Exports → Imports**, select **Netflix**, and upload
   the ZIP file. Ryot reads `{ViewingActivity,Ratings,MyList}.csv` files from the archive
   to build your library.
5. Optionally, enter a **Profile Name** to filter the import to a specific Netflix profile.
   If left empty, all profiles from the export will be imported.

Ryot skips supplemental clips and other autoplay artifacts automatically. After the import
finishes, review the import report for any items that could not be matched.
