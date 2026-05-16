import type {
	EntitySourceV2,
	Expr,
	FieldSelector,
	IncludeEntryV2,
	NestedEventSourceV2,
	QueryDocumentV2,
	RootEventSourceV2,
	SourceV2,
} from "./language";

const MAX_ROOT_PAGE_SIZE = 100;
const MAX_INCLUDE_LIMIT = 100;
const MAX_INCLUDE_DEPTH = 3;
const MAX_EXPRESSION_SOURCE_DEPTH = 3;

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

const EVENT_SYSTEM_FIELDS = new Set(["id", "occurredAt", "createdAt", "updatedAt"]);

type ScopeEntry =
	| { type: "eventSource"; schemas: readonly [string, ...string[]] }
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
		return null;
	}

	return null;
};

const validateExpr = (
	expr: Expr,
	scope: AliasScope,
	aliases: AliasScope,
	expressionSourceDepth = 0,
	allowFirst = false,
): string | null => {
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

	if (expr.type === "exists") {
		if (expressionSourceDepth + 1 > MAX_EXPRESSION_SOURCE_DEPTH) {
			return `Expression source depth exceeds maximum of ${MAX_EXPRESSION_SOURCE_DEPTH}`;
		}
		const sourceScope = new Map(scope);
		return validateSource(expr.source, sourceScope, aliases, expressionSourceDepth + 1);
	}

	if (expr.type === "first") {
		if (!allowFirst) {
			return "First expressions are currently valid only as output fields";
		}
		if (expressionSourceDepth + 1 > MAX_EXPRESSION_SOURCE_DEPTH) {
			return `Expression source depth exceeds maximum of ${MAX_EXPRESSION_SOURCE_DEPTH}`;
		}
		if (expr.source.type !== "events") {
			return "First expression currently supports event sources only";
		}
		const sourceScope = new Map(scope);
		const sourceError = validateSource(
			expr.source,
			sourceScope,
			aliases,
			expressionSourceDepth + 1,
		);
		if (sourceError) {
			return sourceError;
		}
		for (const entry of expr.orderBy) {
			const error = validateExpr(entry.expr, sourceScope, aliases, expressionSourceDepth + 1);
			if (error) {
				return error;
			}
			if (entry.expr.type !== "ref") {
				return "First orderBy currently supports ref expressions only";
			}
			if (
				entry.expr.sourceAlias !== expr.source.alias &&
				entry.expr.sourceAlias !== expr.source.entityRef
			) {
				return `First orderBy cannot reference source alias '${entry.expr.sourceAlias}'`;
			}
		}
		const selectError = validateExpr(expr.select, sourceScope, aliases, expressionSourceDepth + 1);
		if (selectError) {
			return selectError;
		}
		if (expr.select.type === "literal") {
			return null;
		}
		if (expr.select.type !== "ref") {
			return "First select currently supports ref and literal expressions only";
		}
		if (
			expr.select.sourceAlias !== expr.source.alias &&
			expr.select.sourceAlias !== expr.source.entityRef
		) {
			return `First select cannot reference source alias '${expr.select.sourceAlias}'`;
		}
		return null;
	}

	if (expr.type === "comparison") {
		return (
			validateExpr(expr.left, scope, aliases, expressionSourceDepth, false) ??
			validateExpr(expr.right, scope, aliases, expressionSourceDepth, false)
		);
	}

	if (expr.type === "and" || expr.type === "or" || expr.type === "coalesce") {
		for (const value of expr.values) {
			const error = validateExpr(value, scope, aliases, expressionSourceDepth, false);
			if (error) {
				return error;
			}
		}
		return null;
	}

	if (expr.type === "not" || expr.type === "isNull" || expr.type === "isNotNull") {
		return validateExpr(expr.expr, scope, aliases, expressionSourceDepth, false);
	}

	return (
		validateExpr(expr.left, scope, aliases, expressionSourceDepth, false) ??
		validateExpr(expr.right, scope, aliases, expressionSourceDepth, false)
	);
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
		return validateExpr(source.where, scope, aliases);
	}

	return null;
};

const validateNestedEventSource = (
	source: NestedEventSourceV2,
	scope: AliasScope,
	aliases: AliasScope,
) => {
	const schemaError = validateSchemaList(source.schemas);
	if (schemaError) {
		return schemaError;
	}

	const entity = scope.get(source.entityRef);
	if (!entity) {
		return `Unknown source alias '${source.entityRef}'`;
	}
	if (entity.type !== "entitySource") {
		return `Event source entityRef '${source.entityRef}' must reference an entity source`;
	}

	const aliasError = registerAlias(
		scope,
		source.alias,
		{ type: "eventSource", schemas: source.schemas },
		aliases,
	);
	if (aliasError) {
		return aliasError;
	}

	if (source.where !== null) {
		return `Event source '${source.alias}' does not support where yet`;
	}

	return null;
};

const validateRootEventSource = (
	source: RootEventSourceV2,
	scope: AliasScope,
	aliases: AliasScope,
) => {
	const eventSchemaError = validateSchemaList(source.schemas);
	if (eventSchemaError) {
		return eventSchemaError;
	}
	const entitySchemaError = validateSchemaList(source.entity.schemas);
	if (entitySchemaError) {
		return entitySchemaError;
	}

	const aliasError = registerAlias(
		scope,
		source.alias,
		{ type: "eventSource", schemas: source.schemas },
		aliases,
	);
	if (aliasError) {
		return aliasError;
	}

	const entityAliasError = registerAlias(
		scope,
		source.entity.alias,
		{ type: "entitySource", schemas: source.entity.schemas },
		aliases,
	);
	if (entityAliasError) {
		return entityAliasError;
	}

	if (source.where !== null) {
		return `Root event source '${source.alias}' does not support where yet`;
	}

	return null;
};

const validateSource = (
	source: SourceV2,
	scope: AliasScope,
	aliases: AliasScope,
	_expressionSourceDepth = 0,
) =>
	source.type === "entities"
		? validateEntitySource(source, scope, aliases)
		: validateNestedEventSource(source, scope, aliases);

const validateIncludeEntry = (
	include: IncludeEntryV2,
	parentScope: AliasScope,
	aliases: AliasScope,
	depth: number,
): string | null => {
	if (depth > MAX_INCLUDE_DEPTH) {
		return `Include depth exceeds maximum of ${MAX_INCLUDE_DEPTH}`;
	}
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
	for (const childInclude of include.include ?? []) {
		if (outputKeys.has(childInclude.key)) {
			return `Duplicate output field key '${childInclude.key}'`;
		}
		outputKeys.add(childInclude.key);
	}

	for (const entry of include.orderBy) {
		const error = validateExpr(entry.expr, outputScope, aliases);
		if (error) {
			return error;
		}
	}

	for (const field of include.fields) {
		const error = validateExpr(field.expr, outputScope, aliases, 0, true);
		if (error) {
			return error;
		}
	}

	for (const childInclude of include.include ?? []) {
		const error = validateIncludeEntry(childInclude, scope, aliases, depth + 1);
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
	if (source.type === "entities" && source.via !== undefined) {
		return "Root entity source cannot specify via";
	}
	if (source.type === "entities" && source.where !== null) {
		return "Root entity source does not support where yet";
	}

	const sourceError =
		source.type === "entities"
			? validateEntitySource(source, scope, aliases)
			: validateRootEventSource(source, scope, aliases);
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
		const error = validateExpr(entry.expr, scope, aliases);
		if (error) {
			return error;
		}
	}

	for (const field of output.fields) {
		const error = validateExpr(field.expr, scope, aliases, 0, true);
		if (error) {
			return error;
		}
	}

	for (const include of output.include ?? []) {
		const error = validateIncludeEntry(include, scope, aliases, 1);
		if (error) {
			return error;
		}
	}

	return null;
};
