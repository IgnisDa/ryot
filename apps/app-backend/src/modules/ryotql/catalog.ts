import { sql } from "drizzle-orm";

export type CatalogFieldKind = "boolean" | "date" | "json" | "number" | "text";

export type CatalogField = {
	readonly kind: CatalogFieldKind;
	readonly resolve: (sqlAlias: string) => ReturnType<typeof sql>;
};

export type CatalogTable = {
	readonly name: string;
	readonly primaryKey: string;
	readonly userIdColumn: string;
	readonly fields: Readonly<Record<string, CatalogField>>;
};

const physicalField = (column: string, kind: CatalogFieldKind): CatalogField => ({
	kind,
	resolve: (sqlAlias) => sql.raw(`${sqlAlias}.${column}`),
});

const entity: CatalogTable = {
	name: "entity",
	primaryKey: "id",
	userIdColumn: "user_id",
	fields: {
		id: physicalField("id", "text"),
		name: physicalField("name", "text"),
		userId: physicalField("user_id", "text"),
		createdAt: physicalField("created_at", "date"),
		updatedAt: physicalField("updated_at", "date"),
		properties: physicalField("properties", "json"),
		externalId: physicalField("external_id", "text"),
		providerId: physicalField("provider_id", "text"),
		populatedAt: physicalField("populated_at", "date"),
		entitySchemaSlug: physicalField("entity_schema_slug", "text"),
	},
};

const tables: Readonly<Record<string, CatalogTable>> = { entity };

export const getCatalogTable = (name: string) => tables[name];

export const resolveCatalogField = (table: CatalogTable, name: string) => table.fields[name];
