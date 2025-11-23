import type {
	EntitySourceV2,
	Expr,
	FieldSelector,
	IncludeEntryV2,
	QueryDocumentV2,
} from "./language";

const MAX_ROOT_PAGE_SIZE = 100;
const MAX_INCLUDE_LIMIT = 100;

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

type ScopeEntry =
	| { type: "entitySource"; schemas: readonly [string, ...string[]] }
	| { type: "relationshipEdge"; schemas: readonly [string, ...string[]] };
type AliasScope = Map<string, ScopeEntry>;

const registerAlias = (
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

const validateSchemaList = (schemas: readonly string[]) => {
	const seen = new Set<string>();
	for (const schema of schemas) {
		if (seen.has(schema)) {
			return `Duplicate schema '${schema}' in source schemas`;
		}
		seen.add(schema);
	}
	return null;
};

const validateFieldSelector = (field: FieldSelector, entry: ScopeEntry): string | null => {
	if (field.type === "system") {
		const validFields =
			entry.type === "entitySource" ? ENTITY_SYSTEM_FIELDS : RELATIONSHIP_SYSTEM_FIELDS;
		if (!validFields.has(field.name)) {
			const label = entry.type === "entitySource" ? "entity source" : "relationship edge";
			return `Invalid system field '${field.name}' for ${label}. Valid fields: ${[...validFields].join(", ")}`;
		}
		return null;
	}

	if (field.type === "property") {
		if (!entry.schemas.includes(field.schema)) {
			const label = entry.type === "entitySource" ? "source" : "relationship edge";
			return `Property field references schema '${field.schema}' which is not in ${label} schemas [${entry.schemas.join(", ")}]`;
		}
		return null;
	}

	// schema metadata fields are always valid
	return null;
};

const validateExpr = (expr: Expr, scope: AliasScope): string | null => {
	if (expr.type === "literal") {
		return null;
	}

	if (expr.type === "ref") {
		const entry = scope.get(expr.sourceAlias);
		if (!entry) {
			return `Unknown source alias '${expr.sourceAlias}'`;
		}
		return validateFieldSelector(expr.field, entry);
	}

	if (expr.type === "comparison") {
		return validateExpr(expr.left, scope) ?? validateExpr(expr.right, scope);
	}

	if (expr.type === "and" || expr.type === "or" || expr.type === "coalesce") {
		for (const value of expr.values) {
			const error = validateExpr(value, scope);
			if (error) {
				return error;
			}
		}
		return null;
	}

	if (expr.type === "not" || expr.type === "isNull" || expr.type === "isNotNull") {
		return validateExpr(expr.expr, scope);
	}

	// expr.type === "contains" at this point
	return validateExpr(expr.left, scope) ?? validateExpr(expr.right, scope);
};

const validateEntitySource = (source: EntitySourceV2, scope: AliasScope, aliases: AliasScope) => {
	const schemaError = validateSchemaList(source.schemas);
	if (schemaError) {
		return schemaError;
	}

	if (source.via !== undefined) {
		const anchor = scope.get(source.via.entityRef);
		if (!anchor) {
			return `Unknown source alias '${source.via.entityRef}'`;
		}
		if (anchor.type !== "entitySource") {
			return `Relationship traversal anchor '${source.via.entityRef}' must reference an entity source`;
		}

		const edgeAliasError = registerAlias(
			scope,
			source.via.alias,
			{ type: "relationshipEdge", schemas: [source.via.schema] },
			aliases,
		);
		if (edgeAliasError) {
			return edgeAliasError;
		}
	}

	const aliasError = registerAlias(
		scope,
		source.alias,
		{ type: "entitySource", schemas: source.schemas },
		aliases,
	);
	if (aliasError) {
		return aliasError;
	}

	if (source.where !== null) {
		return validateExpr(source.where, scope);
	}

	return null;
};

const validateIncludeEntry = (
	include: IncludeEntryV2,
	parentScope: AliasScope,
	aliases: AliasScope,
) => {
	if (include.limit > MAX_INCLUDE_LIMIT) {
		return `Include limit ${include.limit} exceeds maximum of ${MAX_INCLUDE_LIMIT}`;
	}
	if (include.source.via === undefined) {
		return `Included entity source '${include.source.alias}' must specify via`;
	}
	if (include.source.where !== null) {
		return `Included entity source '${include.source.alias}' does not support where yet`;
	}

	const scope = new Map(parentScope);
	const sourceError = validateEntitySource(include.source, scope, aliases);
	if (sourceError) {
		return sourceError;
	}

	const outputScope: AliasScope = new Map();
	const sourceEntry = scope.get(include.source.alias);
	if (sourceEntry === undefined) {
		return `Unknown source alias '${include.source.alias}'`;
	}
	outputScope.set(include.source.alias, sourceEntry);

	const edgeEntry = scope.get(include.source.via.alias);
	if (edgeEntry === undefined) {
		return `Unknown source alias '${include.source.via.alias}'`;
	}
	outputScope.set(include.source.via.alias, edgeEntry);

	const outputKeys = new Set<string>();
	for (const field of include.fields) {
		if (outputKeys.has(field.key)) {
			return `Duplicate output field key '${field.key}'`;
		}
		outputKeys.add(field.key);
	}

	for (const entry of include.orderBy) {
		const error = validateExpr(entry.expr, outputScope);
		if (error) {
			return error;
		}
	}

	for (const field of include.fields) {
		const error = validateExpr(field.expr, outputScope);
		if (error) {
			return error;
		}
	}

	return null;
};

export const validateQueryDocumentV2 = (doc: QueryDocumentV2): string | null => {
	const scope: AliasScope = new Map();
	const aliases: AliasScope = new Map();
	const { source } = doc;
	if (source.via !== undefined) {
		return "Root entity source cannot specify via";
	}

	const sourceError = validateEntitySource(source, scope, aliases);
	if (sourceError) {
		return sourceError;
	}

	const output = doc.output;

	if (output.pagination.limit > MAX_ROOT_PAGE_SIZE) {
		return `Pagination limit ${output.pagination.limit} exceeds maximum of ${MAX_ROOT_PAGE_SIZE}`;
	}

	const fieldKeys = new Set<string>();
	for (const field of output.fields) {
		if (fieldKeys.has(field.key)) {
			return `Duplicate output field key '${field.key}'`;
		}
		fieldKeys.add(field.key);
	}
	for (const include of output.include ?? []) {
		if (fieldKeys.has(include.key)) {
			return `Duplicate output field key '${include.key}'`;
		}
		fieldKeys.add(include.key);
	}

	for (const entry of output.orderBy) {
		const error = validateExpr(entry.expr, scope);
		if (error) {
			return error;
		}
	}

	for (const field of output.fields) {
		const error = validateExpr(field.expr, scope);
		if (error) {
			return error;
		}
	}

	for (const include of output.include ?? []) {
		const error = validateIncludeEntry(include, scope, aliases);
		if (error) {
			return error;
		}
	}

	return null;
};
