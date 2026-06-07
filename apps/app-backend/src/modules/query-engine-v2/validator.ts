import type { Expr, FieldSelector, QueryDocumentV2 } from "./language";

const MAX_ROOT_PAGE_SIZE = 100;

const ENTITY_SYSTEM_FIELDS = new Set([
	"id",
	"name",
	"image",
	"createdAt",
	"updatedAt",
	"externalId",
	"sandboxScriptId",
]);

type ScopeEntry = { type: "entitySource"; schemas: readonly [string, ...string[]] };
type AliasScope = Map<string, ScopeEntry>;

const registerAlias = (scope: AliasScope, alias: string, entry: ScopeEntry): string | null => {
	if (scope.has(alias)) {
		return `Duplicate alias '${alias}'`;
	}
	scope.set(alias, entry);
	return null;
};

const validateFieldSelector = (field: FieldSelector, entry: ScopeEntry): string | null => {
	if (field.type === "system") {
		if (!ENTITY_SYSTEM_FIELDS.has(field.name)) {
			return `Invalid system field '${field.name}' for entity source. Valid fields: ${[...ENTITY_SYSTEM_FIELDS].join(", ")}`;
		}
		return null;
	}

	if (field.type === "property") {
		if (!entry.schemas.includes(field.schema)) {
			return `Property field references schema '${field.schema}' which is not in source schemas [${entry.schemas.join(", ")}]`;
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

export const validateQueryDocumentV2 = (doc: QueryDocumentV2): string | null => {
	const scope: AliasScope = new Map();
	const { source } = doc;

	const aliasError = registerAlias(scope, source.alias, {
		type: "entitySource",
		schemas: source.schemas,
	});
	if (aliasError) {
		return aliasError;
	}

	const ret = doc.return;

	if (ret.pagination.limit > MAX_ROOT_PAGE_SIZE) {
		return `Pagination limit ${ret.pagination.limit} exceeds maximum of ${MAX_ROOT_PAGE_SIZE}`;
	}

	const fieldKeys = new Set<string>();
	for (const field of ret.fields) {
		if (fieldKeys.has(field.key)) {
			return `Duplicate output field key '${field.key}'`;
		}
		fieldKeys.add(field.key);
	}

	for (const entry of ret.orderBy) {
		const error = validateExpr(entry.expr, scope);
		if (error) {
			return error;
		}
	}

	for (const field of ret.fields) {
		const error = validateExpr(field.expr, scope);
		if (error) {
			return error;
		}
	}

	if (source.where !== null) {
		const error = validateExpr(source.where, scope);
		if (error) {
			return error;
		}
	}

	return null;
};
