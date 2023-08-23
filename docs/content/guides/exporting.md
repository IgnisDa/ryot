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

The export has the following type: `ImportOrExportItem<string>[]`

```ts
{% include 'export-schema.ts' %}
```
