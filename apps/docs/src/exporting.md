# Exporting

You need to have S3 configured to export your data. You can use [this
guide](./guides/file-storage.md) to set it up. The necessary configuration parameters can
be found under the [`FileStorageConfig`](./configuration.md#all-parameters) section. The
export will be made in JSON format and always follows the schema (`CompleteExport`)
described [below](#type-definitions).

You can export your data from the app by going to the "Imports and Exports" settings page
and then clicking the button under the "Export" tab. Once the export is complete, it will
appear along with a button to download it.

You can import it back using the [Generic JSON Importer](./importing/generic-json.md).

## Exporting the entire database

You can export the entire database using the following command:

```bash
docker exec -u postgres -i ryot-db pg_dump -Fc --no-acl --no-owner > /tmp/ryot.file.sql
```

To restore the above dump, run the following command:

```bash
docker exec -u postgres -i ryot-db pg_restore -U postgres -d postgres < /tmp/ryot.file.sql
```

## Type definitions

<<< @/includes/export-schema.ts
