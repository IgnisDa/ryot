# Exporting

You need to have S3 configured in order to export your data. You can find the necessary
configuration parameters under the
[`FileStorageConfig`](../configuration.md#all-parameters) section. The export will be made
in JSON format and always follow the schema (`CompleteExport`) described below.

You can export your data from the app by going to the "You data" page under settings and
then selecting the data you want to export under the "Export" tab.

Once the export is complete, it will appear along with a button to download it.

## Type definition

```ts
{% include 'export-schema.ts' %}
```
