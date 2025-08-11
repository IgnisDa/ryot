# Exporting

You need to have S3 configured in order to export your data. You can find the necessary
configuration parameters under the
[`FileStorageConfig`](./configuration.md#all-parameters) section. The export will be made
in JSON format and always follows the schema (`CompleteExport`) described [below](#type-definitions).

You can export your data from the app by going to the "Imports and Exports" settings page
and then clicking the button under the "Export" tab. Once the export is complete, it will
appear along with a button to download it.

You can import it back using the [Generic JSON Importer](./importing/generic-json.md).

## One time file storage

If you want to use file storage only for exporting, you can configure it to use a public
S3 instance offered by [Minio](https://play.min.io).

::: danger Not for production use
The Minio team resets this instance every 24 hours, hence this method is not suitable
if you want to store the data for a long time.
:::

- Go to the [Minio playground](https://play.min.io). The login credentials are changed
  everyday and you can find them
  [here](https://min.io/docs/minio/linux/administration/minio-console.html#logging-in).
- Click on "Buckets" under the "Administrator" section and then on "Create Bucket".
- Set a name and click on "Create Bucket".
- Click on "Access Keys" under the "User" section and then on "Create access key".
- Leave everything as it is and click on "Create". Copy both the values displayed.
- On your Ryot instance, set the following environment variables:
    ```sh
    FILE_STORAGE_S3_URL=https://play.min.io
    FILE_STORAGE_S3_BUCKET_NAME=ryot-demo
    FILE_STORAGE_S3_ACCESS_KEY_ID=cqXhVseqa4mpqS4RLG3p
    FILE_STORAGE_S3_SECRET_ACCESS_KEY=sJxF4eZkuc4Eo6daGEFhTctzKzGbY6G6qAQTb8Wy
    ```
- Restart your Ryot instance and follow the steps described in the previous section.

## Exporting the entire database

While debugging, I might ask you to send me a database dump. You can do this by exporting
the entire database and emailing the file.

```bash
docker exec -u postgres -i ryot-db pg_dump -Fc --no-acl --no-owner > /tmp/ryot.file.sql
```

To restore the above dump, run the following command:

```bash
docker exec -u postgres -i ryot-db pg_restore -U postgres -d postgres < /tmp/ryot.file.sql
```

## Type definitions

<<< @/includes/export-schema.ts
