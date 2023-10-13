# Exporting

Users can export either their entire data or individual parts of it.

To start, login to your Ryot instance and go to the "Imports and Exports" section
in the "Settings" section. Select the "Export" tab and then generate a new auth token.

The endpoint is in the format of `/export/<type>`. So requests will look like:

```bash
curl <ryot_instance_url>/export/<type> --header 'X-Auth-Token: <token>'
```

## All (`type=all`)

This will return all types of data as described below.

The export has the following type: `ExportAllResponse`.

## Media (`type=media`)

This will return all media that the user has an
[association](https://github.com/IgnisDa/ryot/blob/main/apps/backend/src/migrator/m20230417_create_user.rs#L11-L17)
with.

The export has the following type: `ImportOrExportMediaItem<string>[]`.

## People (`type=people`)

This will return all people that the user has reviewed.

The export has the following type: `ImportOrExportPersonItem[]`.

## Measurements (`type=measurements`)

This will return all measurements made by the user.

The export has the following type: `ExportUserMeasurementItem[]`.

## Workouts (`type=workouts`)

This will return all workouts performed by the user.

The export has the following type: `Workout[]`.

## Type definition

```ts
{% include 'export-schema.ts' %}
```
