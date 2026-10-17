import {
	collectionFieldLimits,
	reservedCollectionFieldKeys,
} from "@ryot-app/contract/modules/collections/fields";
import { maximumCollectionNameLength } from "@ryot-app/contract/modules/collections/schemas";

import type { QualifiedSchema } from "./migration-resolution";
import {
	buildAbortOnRowsSql,
	buildReportSql,
	buildRequireLegacyTableSql,
	quoteNullableSqlString,
	quoteSqlString,
} from "./shared";

const reservedFieldKeysSql = `ARRAY[${[...reservedCollectionFieldKeys].map(quoteSqlString).join(", ")}]`;

export const buildCollectionToEntityRelationshipMigrationSql = (
	addEntityToCollectionEventSchema: QualifiedSchema,
	memberOfRelationshipSchema: QualifiedSchema,
) => `
DO $$
DECLARE
	events_inserted int;
	relationships_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("collection -> entity", "collection_to_entity")}

	INSERT INTO "relationship" (
		"id",
		"user_id",
		"source_entity_id",
		"target_entity_id",
		"relationship_schema_slug",
		"relationship_schema_plugin_id",
		"properties",
		"created_at"
	)
	SELECT
		md5(cte.id::text || ':member-of'),
		coll_entity.user_id,
		cte.entity_id,
		cte.collection_id,
		${quoteSqlString(memberOfRelationshipSchema.slug)},
		${quoteNullableSqlString(memberOfRelationshipSchema.pluginId)},
		CASE WHEN jsonb_typeof(cte.information) = 'object'
			THEN (cte.information - ${reservedFieldKeysSql})
				|| COALESCE(
					(
						SELECT jsonb_object_agg(information.key || '-field', information.value)
						FROM jsonb_each(cte.information) AS information(key, value)
						WHERE information.key = ANY (${reservedFieldKeysSql})
					),
					'{}'::jsonb
				)
			ELSE '{}'::jsonb
		END || jsonb_build_object('rank', cte.rank),
		cte.created_on
	FROM "collection_to_entity" cte
	INNER JOIN "entity" src_entity ON src_entity.id = cte.entity_id
	INNER JOIN "entity" coll_entity ON coll_entity.id = cte.collection_id
	ON CONFLICT DO NOTHING;

	GET DIAGNOSTICS relationships_inserted = ROW_COUNT;

	INSERT INTO "event" (
		"id",
		"user_id",
		"entity_id",
		"event_schema_slug",
		"event_schema_plugin_id",
		"properties",
		"created_at",
		"occurred_at"
	)
	SELECT
		'collection-membership-added-' || rel.id || '-event-0',
		rel.user_id,
		rel.target_entity_id,
		${quoteSqlString(addEntityToCollectionEventSchema.slug)},
		${quoteNullableSqlString(addEntityToCollectionEventSchema.pluginId)},
		jsonb_build_object(
			'entityId', rel.source_entity_id,
			'relationshipId', rel.id,
			'entitySchemaSlug', src_entity.entity_schema_slug,
			'relationshipProperties', rel.properties
		),
		cte.created_on,
		cte.created_on
	FROM "collection_to_entity" cte
	INNER JOIN "relationship" rel
		ON rel.id = md5(cte.id::text || ':member-of')
		AND rel.relationship_schema_slug = ${quoteSqlString(memberOfRelationshipSchema.slug)}
	INNER JOIN "entity" src_entity ON src_entity.id = rel.source_entity_id
	ON CONFLICT DO NOTHING;

	GET DIAGNOSTICS events_inserted = ROW_COUNT;
	${buildReportSql("collection_to_entity -> relationship", [
		{ count: "relationships_inserted", message: "relationship(s) migrated" },
		{ count: "events_inserted", message: "add event(s) migrated" },
	])}
END $$;
`;

export const buildWatchlistBacklogMigrationSql = (input: {
	mediaPluginId: string;
	mediaEntitySchemaSlugs: ReadonlyArray<string>;
}) => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("Watchlist collection -> backlog", "collection")}
	${buildRequireLegacyTableSql("Watchlist collection -> backlog", "collection_to_entity")}

	INSERT INTO "event" (
		"id",
		"user_id",
		"entity_id",
		"event_schema_slug",
		"event_schema_plugin_id",
		"session_entity_id",
		"properties",
		"created_at",
		"occurred_at"
	)
	SELECT
		md5(cte.id::text || ':backlog'),
		coll.user_id,
		cte.entity_id,
		'backlog',
		${quoteSqlString(input.mediaPluginId)},
		CASE WHEN src_entity.entity_schema_slug IN ('show', 'podcast') THEN cte.entity_id END,
		'{}'::jsonb,
		cte.created_on,
		cte.created_on
	FROM "collection_to_entity" cte
	INNER JOIN "collection" coll ON coll.id = cte.collection_id AND coll.name = 'Watchlist'
	INNER JOIN "entity" src_entity ON src_entity.id = cte.entity_id
	WHERE src_entity.entity_schema_plugin_id = ${quoteSqlString(input.mediaPluginId)}
		AND src_entity.entity_schema_slug IN (${input.mediaEntitySchemaSlugs.map(quoteSqlString).join(", ")})
	ON CONFLICT DO NOTHING;

	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	${buildReportSql("Watchlist collection -> backlog", [{ count: "rows_inserted", message: "event(s) migrated" }])}
END $$;
`;

export const buildMonitoringCollectionMigrationSql = (input: {
	libraryEntitySchema: QualifiedSchema;
	mediaMonitoringRelationshipSchema: QualifiedSchema;
	monitorableEntitySchemaSlugs: ReadonlyArray<string>;
}) => `
DO $$
DECLARE
	rows_inserted int;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("collection -> entity", "collection")}

	${buildRequireLegacyTableSql("collection -> entity", "collection_to_entity")}

	IF EXISTS (
		SELECT 1
		FROM "collection_to_entity" cte
		INNER JOIN "collection" coll ON coll.id = cte.collection_id AND coll.name = 'Monitoring'
		INNER JOIN "entity" src_entity ON src_entity.id = cte.entity_id
		WHERE src_entity.user_id IS NULL
			AND src_entity.external_id IS NOT NULL
			AND src_entity.provider_id IS NOT NULL
			AND src_entity.entity_schema_slug IN (${input.monitorableEntitySchemaSlugs.map(quoteSqlString).join(", ")})
			AND src_entity.entity_schema_plugin_id IS NOT DISTINCT FROM ${quoteNullableSqlString(input.libraryEntitySchema.pluginId)}
			AND NOT EXISTS (
				SELECT 1
				FROM "entity" library_entity
				WHERE library_entity.user_id = coll.user_id
					AND library_entity.entity_schema_slug = ${quoteSqlString(input.libraryEntitySchema.slug)}
					AND library_entity.entity_schema_plugin_id IS NOT DISTINCT FROM ${quoteNullableSqlString(input.libraryEntitySchema.pluginId)}
					AND library_entity.external_id IS NULL
					AND library_entity.provider_id IS NULL
			)
	) THEN
		RAISE EXCEPTION 'Monitoring collection -> media-monitoring: a user owns a legacy Monitoring collection but has no V2 library entity to attach it to. Library entities are created earlier in this same run, so this is a defect in this migration rather than in the legacy data. Keep the dump and report it; retrying will not change the result.';
	END IF;

	INSERT INTO "relationship" (
		"id",
		"user_id",
		"source_entity_id",
		"target_entity_id",
		"relationship_schema_slug",
		"relationship_schema_plugin_id",
		"properties",
		"created_at"
	)
	SELECT
		md5(cte.id::text || ':media-monitoring'),
		coll.user_id,
		cte.entity_id,
		library_entity.id,
		${quoteSqlString(input.mediaMonitoringRelationshipSchema.slug)},
		${quoteNullableSqlString(input.mediaMonitoringRelationshipSchema.pluginId)},
		'{}'::jsonb,
		cte.created_on
	FROM "collection_to_entity" cte
	INNER JOIN "collection" coll ON coll.id = cte.collection_id AND coll.name = 'Monitoring'
	INNER JOIN "entity" src_entity ON src_entity.id = cte.entity_id
	INNER JOIN "entity" library_entity
		ON library_entity.user_id = coll.user_id
		AND library_entity.entity_schema_slug = ${quoteSqlString(input.libraryEntitySchema.slug)}
		AND library_entity.entity_schema_plugin_id IS NOT DISTINCT FROM ${quoteNullableSqlString(input.libraryEntitySchema.pluginId)}
		AND library_entity.external_id IS NULL
		AND library_entity.provider_id IS NULL
	WHERE src_entity.user_id IS NULL
		AND src_entity.external_id IS NOT NULL
		AND src_entity.provider_id IS NOT NULL
		AND src_entity.entity_schema_slug IN (${input.monitorableEntitySchemaSlugs.map(quoteSqlString).join(", ")})
		AND src_entity.entity_schema_plugin_id IS NOT DISTINCT FROM ${quoteNullableSqlString(input.libraryEntitySchema.pluginId)}
	ON CONFLICT DO NOTHING;

	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	${buildReportSql("Monitoring collection -> media-monitoring", [{ count: "rows_inserted", message: "relationship(s) migrated" }])}
END $$;
`;

// Marks each Owned-collection member's existing in-media-library relationship as owned, mirroring the
// runtime ownership shape, and carries its V1 "Owned on" member date when Postgres can read it as a
// date. Runs after user-to-entity so the relationships already exist.
export const buildOwnedCollectionOwnershipMigrationSql = (
	inLibraryRelationshipSchema: QualifiedSchema,
) => `
DO $$
DECLARE
	rows_updated int;
	dates_dropped int;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("collection -> entity", "collection")}

	${buildRequireLegacyTableSql("collection -> entity", "collection_to_entity")}

	UPDATE "relationship" rel
	SET "properties" = rel.properties || jsonb_build_object(
		'owned', true,
		'ownershipSources', jsonb_build_array('legacy'),
		'ownershipSyncedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
	) || CASE
		WHEN jsonb_typeof(cte.information -> 'Owned on') = 'string'
			AND pg_input_is_valid(cte.information ->> 'Owned on', 'date')
			THEN jsonb_build_object('ownedOn', to_char((cte.information ->> 'Owned on')::date, 'YYYY-MM-DD'))
		ELSE '{}'::jsonb
	END
	FROM "collection_to_entity" cte
	INNER JOIN "collection" coll ON coll.id = cte.collection_id AND coll.name = 'Owned'
	WHERE rel.relationship_schema_slug = ${quoteSqlString(inLibraryRelationshipSchema.slug)}
		AND rel.relationship_schema_plugin_id IS NOT DISTINCT FROM ${quoteNullableSqlString(inLibraryRelationshipSchema.pluginId)}
		AND rel.source_entity_id = cte.entity_id
		AND rel.user_id = coll.user_id;

	GET DIAGNOSTICS rows_updated = ROW_COUNT;

	SELECT count(*) INTO dates_dropped
	FROM "collection_to_entity" cte
	INNER JOIN "collection" coll ON coll.id = cte.collection_id AND coll.name = 'Owned'
	WHERE jsonb_typeof(cte.information -> 'Owned on') <> 'null'
		AND btrim(cte.information ->> 'Owned on') <> ''
		AND NOT (
			jsonb_typeof(cte.information -> 'Owned on') = 'string'
			AND pg_input_is_valid(cte.information ->> 'Owned on', 'date')
		);

	${buildReportSql("Owned collection -> in-media-library ownership", [
		{ count: "rows_updated", message: "relationship(s) updated" },
		{ count: "dates_dropped", message: "unreadable Owned on date(s) dropped" },
	])}
END $$;
`;

const ecmaScriptTrimCharactersSql = quoteSqlString(
	"\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff",
);

const trimCollectionFieldSql = (expression: string) =>
	`btrim(${expression}, ${ecmaScriptTrimCharactersSql})`;

const legacyTemplateFieldsSql = `
	SELECT
		collection.id AS collection_id,
		field.position,
		CASE WHEN field.element->>'name' = ANY (${reservedFieldKeysSql})
			THEN (field.element->>'name') || '-field'
			ELSE field.element->>'name'
		END AS key,
		${trimCollectionFieldSql("field.element->>'name'")} AS label,
		COALESCE(NULLIF(${trimCollectionFieldSql("field.element->>'description'")}, ''), ${trimCollectionFieldSql("field.element->>'name'")}) AS description,
		field.element->>'lot' AS lot,
		COALESCE((field.element->>'required')::boolean, false) AS required,
		NULLIF(${trimCollectionFieldSql("field.element->>'default_value'")}, '') AS default_value,
		(
			SELECT jsonb_agg(choice.value ORDER BY choice.first_position)
			FROM (
				SELECT ${trimCollectionFieldSql("option.value")} AS value, min(option.position) AS first_position
				FROM jsonb_array_elements_text(
					CASE WHEN jsonb_typeof(field.element->'possible_values') = 'array'
						THEN field.element->'possible_values'
						ELSE '[]'::jsonb
					END
				) WITH ORDINALITY AS option(value, position)
				WHERE ${trimCollectionFieldSql("option.value")} <> ''
				GROUP BY ${trimCollectionFieldSql("option.value")}
			) choice
		) AS choices
	FROM "collection" collection
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE WHEN jsonb_typeof(collection.information_template) = 'array'
			THEN collection.information_template
			ELSE '[]'::jsonb
		END
	) WITH ORDINALITY AS field(element, position)
`;

const legacyTemplateFieldSql = `
	jsonb_build_object('key', field.key, 'label', field.label, 'description', field.description, 'required', field.required)
	|| CASE
		WHEN field.choices IS NOT NULL AND field.lot = 'StringArray'
			THEN jsonb_build_object('type', 'multi-choice', 'choices', field.choices)
		WHEN field.choices IS NOT NULL
			THEN jsonb_build_object('type', 'choice', 'choices', field.choices)
				|| CASE WHEN field.choices @> jsonb_build_array(field.default_value)
					THEN jsonb_build_object('defaultValue', field.default_value)
					ELSE '{}'::jsonb
				END
		WHEN field.lot = 'StringArray'
			THEN '{"type": "text-list"}'::jsonb
		WHEN field.lot = 'Number'
			THEN '{"type": "number"}'::jsonb
				|| CASE WHEN field.default_value ~ '^-?[0-9]+(\\.[0-9]+)?$'
					THEN CASE WHEN abs(field.default_value::numeric) <= ${Number.MAX_VALUE}
						THEN jsonb_build_object('defaultValue', field.default_value::numeric)
						ELSE '{}'::jsonb END
					ELSE '{}'::jsonb
				END
		WHEN field.lot = 'Boolean'
			THEN '{"type": "boolean"}'::jsonb
				|| CASE WHEN lower(field.default_value) IN ('true', 'false')
					THEN jsonb_build_object('defaultValue', lower(field.default_value)::boolean)
					ELSE '{}'::jsonb
				END
		WHEN field.lot = 'Date'
			THEN '{"type": "date"}'::jsonb
				|| CASE WHEN field.default_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
					AND pg_input_is_valid(field.default_value, 'date')
					THEN jsonb_build_object('defaultValue', field.default_value)
					ELSE '{}'::jsonb
				END
		WHEN field.lot = 'DateTime'
			THEN '{"type": "datetime"}'::jsonb
				|| CASE WHEN field.default_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$'
					AND pg_input_is_valid(field.default_value, 'timestamptz')
					THEN jsonb_build_object('defaultValue', field.default_value)
					ELSE '{}'::jsonb
				END
		ELSE '{"type": "text"}'::jsonb
			|| CASE WHEN field.default_value IS NOT NULL
				THEN jsonb_build_object('defaultValue', field.default_value)
				ELSE '{}'::jsonb
			END
	END
`;

export const buildCollectionEntityMigrationSql = (entitySchema: QualifiedSchema) => `
DO $$
DECLARE
	rows_inserted int;
	invalid_name_count int;
	invalid_name_sample text;
	duplicate_name_count int;
	duplicate_name_sample text;
	unnamed_field_count int;
	unnamed_field_sample text;
	invalid_field_count int;
	invalid_field_sample text;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql("collection -> entity", "collection")}

	${buildAbortOnRowsSql({
		countVariable: "invalid_name_count",
		sampleVariable: "invalid_name_sample",
		source: `
			SELECT collection.id AS label
			FROM "collection" collection
			WHERE btrim(collection.name) = '' OR char_length(btrim(collection.name)) > ${maximumCollectionNameLength}
		`,
		message: `collection -> entity: % collection(s) have a name that is blank or longer than ${maximumCollectionNameLength} characters after trimming surrounding whitespace: %. V2 collection names must be non-empty and at most ${maximumCollectionNameLength} characters. Rename those collections in the V1 database, then start the server again.`,
	})}
	${buildAbortOnRowsSql({
		countVariable: "duplicate_name_count",
		sampleVariable: "duplicate_name_sample",
		source: `
			SELECT collection.user_id || ':' || string_agg(collection.id, ',' ORDER BY collection.id) AS label
			FROM "collection" collection
			GROUP BY collection.user_id, btrim(collection.name)
			HAVING count(*) > 1
		`,
		message:
			"collection -> entity: % group(s) of one user's collections have names that become identical once surrounding whitespace is trimmed: %. V2 collection names are unique per user. Rename one collection in each group in the V1 database, then start the server again.",
	})}
	${buildAbortOnRowsSql({
		countVariable: "unnamed_field_count",
		sampleVariable: "unnamed_field_sample",
		source: `
			SELECT field.collection_id || ':' || field.position::text AS label
			FROM (${legacyTemplateFieldsSql}) field
			WHERE field.label IS NULL OR field.label = ''
		`,
		message:
			"collection -> entity: % collection information template field(s) have a blank name: %. Each V2 collection field needs a label. Name or remove those fields in the V1 collection settings, then start the server again.",
	})}
	${buildAbortOnRowsSql({
		countVariable: "invalid_field_count",
		sampleVariable: "invalid_field_sample",
		message:
			"collection -> entity: % information template field(s) exceed V2 field limits or have duplicate keys after reserved-key mapping: %. V2 requires unique keys and bounded field declarations. Shorten or remove those fields or choices, or rename colliding fields in V1, then restart the migration.",
		source: `
			WITH fields AS (${legacyTemplateFieldsSql})
			SELECT field.collection_id || ':' || field.position::text AS label
			FROM fields field
			WHERE char_length(field.label) > ${collectionFieldLimits.labelLength}
				OR char_length(field.description) > ${collectionFieldLimits.descriptionLength}
				OR jsonb_array_length(COALESCE(field.choices, '[]'::jsonb)) > ${collectionFieldLimits.choices}
				OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(field.choices) choice(value) WHERE char_length(choice.value) > ${collectionFieldLimits.choiceLength})
				OR (SELECT count(*) FROM fields other WHERE other.collection_id = field.collection_id) > ${collectionFieldLimits.fields}
				OR (SELECT count(*) FROM fields other WHERE other.collection_id = field.collection_id AND other.key = field.key) > 1
		`,
	})}

	INSERT INTO "entity" (
		"id",
		"external_id",
		"name",
		"created_at",
		"populated_at",
		"user_id",
		"properties",
		"entity_schema_slug",
		"entity_schema_plugin_id",
		"provider_id",
		"updated_at"
	)
	SELECT
		collection.id,
		NULL,
		btrim(collection.name),
		collection.created_on,
		NULL,
		collection.user_id,
		(
			CASE WHEN collection.description IS NOT NULL
				THEN jsonb_build_object('description', collection.description)
				ELSE '{}'::jsonb
			END
		)
		||
		(
			jsonb_build_object('membershipFields', COALESCE(template.fields, '[]'::jsonb))
		),
		${quoteSqlString(entitySchema.slug)},
		${quoteNullableSqlString(entitySchema.pluginId)},
		NULL,
		collection.last_updated_on
	FROM "collection"
	LEFT JOIN LATERAL (
		SELECT jsonb_agg(${legacyTemplateFieldSql} ORDER BY field.position) AS fields
		FROM (${legacyTemplateFieldsSql}) field
		WHERE field.collection_id = collection.id
	) template ON true
	ON CONFLICT ("id") DO NOTHING;

	GET DIAGNOSTICS rows_inserted = ROW_COUNT;
	${buildReportSql("collection -> entity", [{ count: "rows_inserted", message: "row(s) migrated" }])}
END $$;
`;
