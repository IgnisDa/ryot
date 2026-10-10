# Data JSON

Data JSON is Ryot's own import format. It is built in, so no plugin is needed. One JSON document
can add entities, relationships, and events. Upload it in **Settings > Import data** or send it to a
Data webhook integration.

## Prepare a document

The document has three arrays: `entities`, `relationships`, and `events`. Each record must use a
schema that already exists in your Ryot instance. Data JSON does not add schemas or change
configuration. A document can be up to 32 MiB.

Each entity has a `key` and one of three kinds:

- `custom` creates a new entity owned by you. It has `entitySchemaSlug`, `name`, and `properties`.
- `existing` points to an entity you can already access, using `entityId` and `entitySchemaSlug`.
- `provider` looks up an entity using `providerSlug`, `identifierType`, and `value`. If the lookup
  fails, that record fails. Ryot does not create a custom entity in its place.

Every `key` must be unique across the whole document. Relationships connect two entities with
`sourceEntityKey` and `targetEntityKey`. Events use `entityKey`, and can also use `sessionEntityKey`.
Properties that the schema marks as entity or relationship references also use keys from the
document, including inside nested objects and arrays. Ryot replaces them with the real IDs.

Property names and values must match the schemas. Event `occurredAt` values must be UTC timestamps.
Data JSON does not upload files, but asset fields can point to assets Ryot already stores.

This example shows each kind of record and how keys connect them:

```json
{
	"entities": [
		{
			"kind": "custom",
			"key": "film",
			"entitySchemaSlug": "example.film",
			"name": "Example film",
			"properties": { "note": "An illustrative property" }
		},
		{
			"kind": "existing",
			"key": "person",
			"entitySchemaSlug": "example.person",
			"entityId": "existing-entity-id"
		},
		{
			"kind": "provider",
			"key": "session",
			"entitySchemaSlug": "example.session",
			"providerSlug": "example-provider",
			"identifierType": "session",
			"value": "provider-value"
		}
	],
	"relationships": [
		{
			"key": "credit",
			"relationshipSchemaSlug": "example.credit",
			"sourceEntityKey": "film",
			"targetEntityKey": "person",
			"properties": { "role": "writer" }
		}
	],
	"events": [
		{
			"key": "activity",
			"eventSchemaSlug": "example.activity",
			"entityKey": "film",
			"sessionEntityKey": "session",
			"occurredAt": "2026-01-15T12:00:00Z",
			"properties": { "details": { "relatedEntity": "person", "creditRelationship": "credit" } }
		}
	]
}
```

Everything starting with `example`, and the IDs and property fields, are placeholders. Replace them
with schemas and fields from your instance. In this example, the event schema would need to mark
`details.relatedEntity` as an entity reference and `details.creditRelationship` as a relationship
reference.

## Upload a file

In **Settings > Import data**, select **Data JSON** and upload the document as a `.json` file.
Uploading the same file again starts a new import and can add the same activity twice.

## Send a webhook

Create a Data webhook integration in **Settings > Integrations** and copy its webhook URL. Save your
document as `data.json`, then send it with both of these headers:

```sh
WEBHOOK_URL='paste the URL copied from the integration'
curl --fail \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: data-import-2026-01-15-01' \
  --data-binary @data.json \
  "$WEBHOOK_URL"
```

The `Idempotency-Key` makes retries safe. Sending the same document with the same key returns the
original import instead of starting a new one, even after that import finished, failed, or was
cancelled. Sending a different document with a used key returns HTTP `409`. Use a new key for each
new document. A key stays used even if you delete its import report.

## How records are saved

Records are saved one at a time and only ever add data. If one record fails, records already saved
stay saved, and records that do not depend on it can still succeed. Records that depend on each
other in a loop fail. Check the import report for failed records.
