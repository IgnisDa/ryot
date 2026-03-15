import { sql } from "drizzle-orm";

export type CatalogFieldKind = "boolean" | "date" | "json" | "number" | "text";

export type CatalogFieldContext = {
	readonly sqlAlias: string;
	readonly language: string | null;
};

export type CatalogField = {
	readonly kind: CatalogFieldKind;
	readonly resolve: (context: CatalogFieldContext) => ReturnType<typeof sql>;
};

export type CatalogTable = {
	readonly name: string;
	readonly primaryKey: string;
	readonly userIdColumn: string;
	readonly fields: Readonly<Record<string, CatalogField>>;
};

const physicalField = (column: string, kind: CatalogFieldKind): CatalogField => ({
	kind,
	resolve: ({ sqlAlias }) => sql.raw(`${sqlAlias}.${column}`),
});

const localizedEntityName: CatalogField = {
	kind: "text",
	resolve: ({ language, sqlAlias }) =>
		language === null
			? sql.raw(`${sqlAlias}.name`)
			: sql`COALESCE((SELECT translation.name FROM entity_translation translation WHERE translation.entity_id = ${sql.raw(`${sqlAlias}.id`)} AND translation.language = ${language}), ${sql.raw(`${sqlAlias}.name`)})`,
};

const localizedEntityProperties: CatalogField = {
	kind: "json",
	resolve: ({ language, sqlAlias }) =>
		language === null
			? sql.raw(`${sqlAlias}.properties`)
			: sql`${sql.raw(`${sqlAlias}.properties`)} || COALESCE((SELECT translation.properties FROM entity_translation translation WHERE translation.entity_id = ${sql.raw(`${sqlAlias}.id`)} AND translation.language = ${language}), '{}'::jsonb)`,
};

const entityTranslationStatus: CatalogField = {
	kind: "text",
	resolve: ({ language, sqlAlias }) => {
		if (language === null) {
			return sql`'none'::text`;
		}
		const id = sql.raw(`${sqlAlias}.id`);
		const providerId = sql.raw(`${sqlAlias}.provider_id`);
		const populatedAt = sql.raw(`${sqlAlias}.populated_at`);
		const canonicalLanguage = sql`(SELECT provider.information ->> 'canonicalLanguage' FROM sandbox_provider provider WHERE provider.id = ${providerId})`;
		return sql`CASE
			WHEN ${providerId} IS NULL THEN 'none'
			WHEN ${canonicalLanguage} IS NULL THEN 'none'
			WHEN ${canonicalLanguage} = ${language} THEN 'none'
			WHEN ${populatedAt} IS NULL THEN 'none'
			WHEN NOT EXISTS (SELECT 1 FROM entity_translation translation WHERE translation.entity_id = ${id} AND translation.language = ${language}) THEN 'pending'
			WHEN (SELECT translation.name IS NULL AND (translation.properties IS NULL OR translation.properties = '{}'::jsonb) FROM entity_translation translation WHERE translation.entity_id = ${id} AND translation.language = ${language}) THEN 'none'
			ELSE 'ready'
		END`;
	},
};

const entity: CatalogTable = {
	name: "entity",
	primaryKey: "id",
	userIdColumn: "user_id",
	fields: {
		name: localizedEntityName,
		properties: localizedEntityProperties,
		translationStatus: entityTranslationStatus,
		id: physicalField("id", "text"),
		userId: physicalField("user_id", "text"),
		createdAt: physicalField("created_at", "date"),
		updatedAt: physicalField("updated_at", "date"),
		externalId: physicalField("external_id", "text"),
		providerId: physicalField("provider_id", "text"),
		populatedAt: physicalField("populated_at", "date"),
		entitySchemaSlug: physicalField("entity_schema_slug", "text"),
	},
};

const event: CatalogTable = {
	name: "event",
	primaryKey: "id",
	userIdColumn: "user_id",
	fields: {
		id: physicalField("id", "text"),
		userId: physicalField("user_id", "text"),
		entityId: physicalField("entity_id", "text"),
		createdAt: physicalField("created_at", "date"),
		updatedAt: physicalField("updated_at", "date"),
		properties: physicalField("properties", "json"),
		occurredAt: physicalField("occurred_at", "date"),
		eventSchemaSlug: physicalField("event_schema_slug", "text"),
		sessionEntityId: physicalField("session_entity_id", "text"),
	},
};

const tables: Readonly<Record<string, CatalogTable>> = { entity, event };

export const getCatalogTable = (name: string) => tables[name];

export const resolveCatalogField = (table: CatalogTable, name: string) => table.fields[name];
