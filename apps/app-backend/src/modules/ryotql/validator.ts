import type {
	NamedQuery,
	Predicate,
	RyotQLDocument,
	ScalarExpression,
} from "@ryot/contract/modules/ryotql/language";

import { getCatalogTable, resolveCatalogField, type CatalogTable } from "./catalog";

export const MAX_QUERY_JOINS = 8;
export const MAX_ROOT_PAGE_SIZE = 100;
export const MAX_DOCUMENT_QUERIES = 10;

type AliasScope = ReadonlyMap<string, CatalogTable>;
type ScalarKind = CatalogTable["fields"][string]["kind"] | "null";

const requiredNameError = (value: string, label: string) =>
	value.trim().length === 0 ? `${label} must not be empty` : null;

const validateExpression = (expr: ScalarExpression, scope: AliasScope): string | null => {
	if (expr.type === "literal") {
		return null;
	}
	const table = scope.get(expr.tableAlias);
	if (!table) {
		return `Unknown table alias '${expr.tableAlias}'`;
	}
	return resolveCatalogField(table, expr.field)
		? null
		: `Unknown field '${expr.field}' on table '${table.name}'`;
};

const expressionKind = (expr: ScalarExpression, scope: AliasScope): ScalarKind | undefined => {
	if (expr.type === "literal") {
		if (expr.value === null) {
			return "null";
		}
		if (typeof expr.value === "boolean") {
			return "boolean";
		}
		if (typeof expr.value === "number") {
			return "number";
		}
		if (typeof expr.value === "string") {
			return "text";
		}
		return "json";
	}
	const table = scope.get(expr.tableAlias);
	return table ? resolveCatalogField(table, expr.field)?.kind : undefined;
};

const compatibleKinds = (left: ScalarKind | undefined, right: ScalarKind | undefined) =>
	left === "null" || right === "null" || left === right;

const validatePredicate = (predicate: Predicate, scope: AliasScope): string | null => {
	if (predicate.type === "comparison") {
		const expressionError =
			validateExpression(predicate.left, scope) ?? validateExpression(predicate.right, scope);
		if (expressionError) {
			return expressionError;
		}
		return compatibleKinds(
			expressionKind(predicate.left, scope),
			expressionKind(predicate.right, scope),
		)
			? null
			: "Comparison operands must have compatible types";
	}
	const expressionError =
		validateExpression(predicate.expr, scope) ??
		predicate.values.map((value) => validateExpression(value, scope)).find(Boolean) ??
		null;
	if (expressionError) {
		return expressionError;
	}
	const expressionType = expressionKind(predicate.expr, scope);
	return predicate.values.every((value) =>
		compatibleKinds(expressionType, expressionKind(value, scope)),
	)
		? null
		: "Membership values must have compatible types";
};

const addTable = (
	scope: Map<string, CatalogTable>,
	reference: NamedQuery["from"],
): string | null => {
	const aliasError = requiredNameError(reference.alias, "Table alias");
	if (aliasError) {
		return aliasError;
	}
	if (scope.has(reference.alias)) {
		return `Duplicate table alias '${reference.alias}'`;
	}
	const table = getCatalogTable(reference.table);
	if (!table) {
		return `Unknown table '${reference.table}'`;
	}
	scope.set(reference.alias, table);
	return null;
};

const validateNamedQuery = (query: NamedQuery): string | null => {
	const joins = query.joins ?? [];
	if (joins.length > MAX_QUERY_JOINS) {
		return `A query may contain at most ${MAX_QUERY_JOINS} joins`;
	}
	if (query.output.pagination.limit > MAX_ROOT_PAGE_SIZE) {
		return `Rows limit must not exceed ${MAX_ROOT_PAGE_SIZE}`;
	}

	const scope = new Map<string, CatalogTable>();
	const rootError = addTable(scope, query.from);
	if (rootError) {
		return rootError;
	}
	for (const join of joins) {
		const tableError = addTable(scope, join.table);
		if (tableError) {
			return tableError;
		}
		const onError = validatePredicate(join.on, scope);
		if (onError) {
			return onError;
		}
	}

	const whereError = query.where ? validatePredicate(query.where, scope) : null;
	if (whereError) {
		return whereError;
	}

	const keys = new Set<string>();
	for (const field of query.output.fields) {
		const keyError = requiredNameError(field.key, "Output field key");
		if (keyError) {
			return keyError;
		}
		if (keys.has(field.key)) {
			return `Duplicate output field key '${field.key}'`;
		}
		keys.add(field.key);
		const fieldError = validateExpression(field.expr, scope);
		if (fieldError) {
			return fieldError;
		}
		if (field.expr.type === "literal") {
			return "Literal field projections are not supported yet";
		}
	}

	return (
		query.output.orderBy.map((order) => validateExpression(order.expr, scope)).find(Boolean) ?? null
	);
};

export const validateRyotQLDocument = (document: RyotQLDocument): string | null => {
	const queries = Object.entries(document.queries);
	if (queries.length === 0) {
		return "A RyotQL document must contain at least one named query";
	}
	if (queries.length > MAX_DOCUMENT_QUERIES) {
		return `A RyotQL document may contain at most ${MAX_DOCUMENT_QUERIES} named queries`;
	}
	for (const [name, query] of queries) {
		const nameError = requiredNameError(name, "Query name");
		if (nameError) {
			return nameError;
		}
		const queryError = validateNamedQuery(query);
		if (queryError) {
			return `Query '${name}': ${queryError}`;
		}
	}
	return null;
};
