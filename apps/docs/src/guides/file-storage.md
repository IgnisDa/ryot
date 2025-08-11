# File Storage

## Minio

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
- Restart your Ryot instance and follow the steps described in the [Exporting](../exporting.md) section.
