import type { FieldSelector } from "../language";

export const MAX_INCLUDE_DEPTH = 3;
export const MAX_INCLUDE_LIMIT = 100;
export const MAX_ROOT_PAGE_SIZE = 100;
export const MAX_TIME_SERIES_BUCKETS = 1000;
export const MAX_EXPRESSION_SOURCE_DEPTH = 3;
export const MAX_GROUPED_AGGREGATE_LIMIT = 1000;

const EVENT_SYSTEM_FIELDS = new Set(["id", "occurredAt", "createdAt", "updatedAt"]);

const ENTITY_SYSTEM_FIELDS = new Set([
	"id",
	"name",
	"image",
	"createdAt",
	"updatedAt",
	"externalId",
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
		const validFields =
			entry.type === "entitySource"
				? ENTITY_SYSTEM_FIELDS
				: entry.type === "eventSource"
					? EVENT_SYSTEM_FIELDS
					: RELATIONSHIP_SYSTEM_FIELDS;
		if (!validFields.has(field.name)) {
			const label =
				entry.type === "entitySource"
					? "entity source"
					: entry.type === "eventSource"
						? "event source"
						: "relationship edge";
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
