import type { FieldSelector } from "../language";

export const MAX_INCLUDE_DEPTH = 3;
export const MAX_INCLUDE_LIMIT = 100;
export const MAX_ROOT_PAGE_SIZE = 100;
export const MAX_TIME_SERIES_BUCKETS = 1000;
export const MAX_EXPRESSION_SOURCE_DEPTH = 3;
export const MAX_GROUPED_AGGREGATE_LIMIT = 1000;
// Rows output field/include keys become SQL column aliases (`<key>__v`/`__k`/`__inc`). Postgres
// truncates identifiers at 63 bytes, so a longer key could collide with another after truncation;
// cap the key so the longest suffix (`__inc`, 5 bytes) still fits.
export const MAX_OUTPUT_KEY_LENGTH = 58;

export const outputKeyLengthError = (key: string): string | null =>
	new TextEncoder().encode(key).length > MAX_OUTPUT_KEY_LENGTH
		? `Output field key '${key}' exceeds maximum length of ${MAX_OUTPUT_KEY_LENGTH} bytes`
		: null;

const EVENT_SYSTEM_FIELDS = new Set([
	"id",
	"userId",
	"entityId",
	"createdAt",
	"updatedAt",
	"occurredAt",
	"properties",
	"eventSchemaId",
	"sessionEntityId",
]);

const ENTITY_SYSTEM_FIELDS = new Set([
	"id",
	"name",
	"userId",
	"createdAt",
	"updatedAt",
	"properties",
	"externalId",
	"populatedAt",
	"entitySchemaId",
	"sandboxScriptId",
]);

const RELATIONSHIP_SYSTEM_FIELDS = new Set(["id", "sourceEntityId", "targetEntityId", "createdAt"]);

export type ScopeEntry =
	| { type: "eventSource"; schemas: readonly [string, ...string[]] }
	| { type: "entitySource"; schemas: readonly [string, ...string[]] }
	| { type: "relationshipEdge"; schemas: readonly [string, ...string[]] };

export type AliasScope = Map<string, ScopeEntry>;

export const registerAlias = (
	scope: AliasScope,
	alias: string,
	entry: ScopeEntry,
	aliases: AliasScope,
): string | null => {
	if (aliases.has(alias)) {
		return `Duplicate alias '${alias}'`;
	}

	aliases.set(alias, entry);
	scope.set(alias, entry);
	return null;
};

export const validateSchemaList = (schemas: readonly string[]) => {
	const seen = new Set<string>();
	for (const schema of schemas) {
		if (seen.has(schema)) {
			return `Duplicate schema '${schema}' in source schemas`;
		}
		seen.add(schema);
	}
	return null;
};

export const validateFieldSelector = (field: FieldSelector, entry: ScopeEntry): string | null => {
	if (field.type === "system") {
		let validFields: ReadonlySet<string>;
		let label: string;
		switch (entry.type) {
			case "entitySource":
				validFields = ENTITY_SYSTEM_FIELDS;
				label = "entity source";
				break;
			case "eventSource":
				validFields = EVENT_SYSTEM_FIELDS;
				label = "event source";
				break;
			case "relationshipEdge":
				validFields = RELATIONSHIP_SYSTEM_FIELDS;
				label = "relationship edge";
				break;
		}
		if (!validFields.has(field.name)) {
			return `Invalid system field '${field.name}' for ${label}. Valid fields: ${[...validFields].join(", ")}`;
		}
		return null;
	}

	if (field.type === "property") {
		if (!entry.schemas.includes(field.schema)) {
			const label = entry.type === "relationshipEdge" ? "relationship edge" : "source";
			return `Property field references schema '${field.schema}' which is not in ${label} schemas [${entry.schemas.join(", ")}]`;
		}
	}

	return null;
};
