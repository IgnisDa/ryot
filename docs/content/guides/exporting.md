# Exporting

Users can export either their entire data or individual parts of it.

To start, login to your Ryot instance and go to the "Tokens" section in the
"Settings" page. Then, generate a new application token.

The base endpoint is `<ryot_url>/export`. So requests will look like:

```bash
curl <ryot_url>/export/<type> --header 'Authorization: Bearer <token>'
```

For example:

```bash
curl 'https://ryot.fly.dev/export/media' --header 'Authorization: Bearer 0ab88f6b-768a-4d65-885b-502016b634e0'
```

## Media (`type=media`)

This will return all media that the user has an
[association](https://github.com/IgnisDa/ryot/blob/e17bab9109d4737d7a7348780cc33dc73f1a59ce/apps/backend/src/migrator/m20230417_create_user.rs#L11-L17) with.

The export has the following type: `ImportOrExportItem<string>[]`

```ts
{% include 'export-schema.ts' %}
```
