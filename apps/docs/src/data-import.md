# Data import and webhook

The `data-json` source is built into Ryot. It imports entities, relationships, and events from one
JSON document. You can upload a document in **Settings > Import data** or send it to a Data webhook
integration. No plugin installation is needed.

## Prepare a document

The document has three arrays: `entities`, `relationships`, and `events`. Each record must use a
schema that is already available in your Ryot instance. Data import does not install schema
definitions, import a profile, or change configuration. The complete document can be up to 32 MiB.

Each entity has a unique `key` for this document and one of three kinds:

- `custom` creates an entity owned by your account. It has `entitySchemaSlug`, `name`, and
  `properties`.
- `existing` refers to an entity by `entityId` and `entitySchemaSlug`. You must have access to that
  entity.
- `provider` resolves `providerSlug`, `identifierType`, and `value` through the normal provider
  path. If resolution fails, that record fails; Ryot does not create a custom entity instead.

Keys must be unique across all three arrays. Relationships use `sourceEntityKey` and
`targetEntityKey`; events use `entityKey` and may use `sessionEntityKey`. These fields point to
entity keys in the document. String properties that the destination schema declares as entity or
relationship references also use document keys, including inside nested objects and arrays. Ryot
rewrites those values to the destination IDs.

Property names and values must match the destination schemas. Event `occurredAt` values must be UTC
timestamps. Schema-declared managed asset fields may refer to assets already managed by Ryot; Data
import does not upload binary files.

This compact example shows the record shapes and reference keys:

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

The `example.*` slugs, IDs, provider values, and property fields are illustrative, not built-in
schemas or universal media fields. Replace them with definitions and fields available in your
instance. For example, `details.relatedEntity` must be declared as an entity reference and
`details.creditRelationship` as a relationship reference in the event schema.

## Upload a file

In **Settings > Import data**, select **Data JSON** and upload the document as a `.json` file. The
form accepts an optional `submissionKey` so a retry can reuse the same run.

## Send a webhook

Create a Data webhook integration in **Settings > Integrations** and copy its webhook URL. Keep the
URL private. Save a schema-valid document as `data.json`, then send it with both required headers:

```sh
WEBHOOK_URL='paste the URL copied from the integration'
curl --fail \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: data-import-2026-01-15-01' \
  --data-binary @data.json \
  "$WEBHOOK_URL"
```

The webhook URL is the destination shown in the integration details. `data.json` must contain a
document that matches the schemas available in your instance.

## Retries and results

Keys are scoped to the manual user or the webhook integration. Retry the same document with the same
key to reuse its original run, even if that run completed, failed, or was cancelled. Reusing a key
with a different document returns HTTP `409`. Use a new key for a new submission; it appends new
activity. Keys remain reserved if you delete the run report.

Data JSON uses append-only writes through Ryot's normal write paths and lifecycle hooks. Records
commit incrementally: a failed record does not undo records already committed, and independent
records can still succeed. Cyclic record dependencies fail the affected records. Check the import
report for failures and partial results.
