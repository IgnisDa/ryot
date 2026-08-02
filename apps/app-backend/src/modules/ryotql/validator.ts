import type {
	AggregateOutput,
	CorrelatedQuerySet,
	FieldSelection,
	Include,
	NamedQuery,
	OrderBy,
	Predicate,
	RyotQLDocument,
	ScalarExpression,
	TableReference,
	TimeSeriesOutput,
} from "@ryot/contract/modules/ryotql/language";
import { DateTime, Duration, Option } from "effect";

import {
	canAccessCatalogTable,
	getCatalogTable,
	resolveCatalogField,
	type CatalogTable,
	type RyotQLExecutionScope,
} from "./catalog";

export const MAX_QUERY_JOINS = 8;
export const MAX_INCLUDE_DEPTH = 3;
export const MAX_INCLUDE_LIMIT = 100;
export const MAX_ROOT_PAGE_SIZE = 100;
export const MAX_CORRELATED_DEPTH = 3;
export const MAX_DOCUMENT_QUERIES = 10;
export const MAX_TIME_SERIES_BUCKETS = 1000;
export const MAX_GROUPED_AGGREGATE_LIMIT = 1000;

type AliasScope = ReadonlyMap<string, CatalogTable>;
type ScalarKind = CatalogTable["fields"][string]["kind"] | "null";

const requiredNameError = (value: string, label: string) =>
	value.trim().length === 0 ? `${label} must not be empty` : null;

const validateExpression = (
	expr: ScalarExpression,
	scope: AliasScope,
	correlatedDepth: number,
	executionScope: Pick<RyotQLExecutionScope, "type">,
): string | null => {
	if (expr.type === "literal") {
		return null;
	}
	if (expr.type === "cast") {
		return validateExpression(expr.expr, scope, correlatedDepth, executionScope);
	}
	if (expr.type === "coalesce") {
		return (
			expr.values
				.map((value) => validateExpression(value, scope, correlatedDepth, executionScope))
				.find(Boolean) ?? null
		);
	}
	if (expr.type === "arithmetic") {
		return (
			validateExpression(expr.left, scope, correlatedDepth, executionScope) ??
			validateExpression(expr.right, scope, correlatedDepth, executionScope)
		);
	}
	if (expr.type === "exists" || expr.type === "aggregate" || expr.type === "first") {
		if (correlatedDepth >= MAX_CORRELATED_DEPTH) {
			return `Correlated query depth must not exceed ${MAX_CORRELATED_DEPTH}`;
		}
		const nested = validateQuerySet(expr.query, scope, correlatedDepth + 1, executionScope);
		if (nested.error || !nested.scope) {
			return nested.error;
		}
		if (expr.type === "aggregate" && expr.aggregation.function !== "count") {
			return validateExpression(
				expr.aggregation.expr,
				nested.scope,
				correlatedDepth + 1,
				executionScope,
			);
		}
		if (expr.type === "first") {
			const selectionError = validateExpression(
				expr.select,
				nested.scope,
				correlatedDepth + 1,
				executionScope,
			);
			if (selectionError) {
				return selectionError;
			}
			for (const order of expr.orderBy) {
				const orderError = validateExpression(
					order.expr,
					nested.scope,
					correlatedDepth + 1,
					executionScope,
				);
				if (orderError) {
					return orderError;
				}
				if (expressionKind(order.expr, nested.scope) === "json") {
					return "Ordering expressions must resolve to scalar values";
				}
			}
		}
		return null;
	}
	if (expr.type === "jsonPath") {
		const expressionError = validateExpression(expr.expr, scope, correlatedDepth, executionScope);
		if (expressionError) {
			return expressionError;
		}
		return expressionKind(expr.expr, scope) === "json"
			? null
			: "JSON paths require a JSON expression";
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
	if (expr.type === "cast") {
		return expr.target;
	}
	if (expr.type === "exists") {
		return "boolean";
	}
	if (expr.type === "arithmetic" || expr.type === "aggregate") {
		return "number";
	}
	if (expr.type === "first") {
		return expressionKind(expr.select, expressionScope(expr.query, scope));
	}
	if (expr.type === "jsonPath") {
		return "json";
	}
	if (expr.type === "coalesce") {
		const kinds = expr.values.map((value) => expressionKind(value, scope));
		const nonNullKinds = kinds.filter((kind) => kind !== "null");
		const first = nonNullKinds[0];
		return first && nonNullKinds.every((kind) => kind === first) ? first : "json";
	}
	const table = scope.get(expr.tableAlias);
	return table ? resolveCatalogField(table, expr.field)?.kind : undefined;
};

const compatibleKinds = (left: ScalarKind | undefined, right: ScalarKind | undefined) =>
	left === "null" || right === "null" || left === right;

const validatePredicate = (
	predicate: Predicate,
	scope: AliasScope,
	correlatedDepth: number,
	executionScope: Pick<RyotQLExecutionScope, "type">,
): string | null => {
	if (predicate.type === "exists") {
		return validateExpression(predicate, scope, correlatedDepth, executionScope);
	}
	if (predicate.type === "comparison") {
		const expressionError =
			validateExpression(predicate.left, scope, correlatedDepth, executionScope) ??
			validateExpression(predicate.right, scope, correlatedDepth, executionScope);
		if (expressionError) {
			return expressionError;
		}
		const left = expressionKind(predicate.left, scope);
		const right = expressionKind(predicate.right, scope);
		if (!compatibleKinds(left, right)) {
			return "Comparison operands must have compatible types";
		}
		return predicate.operator === "eq" || predicate.operator === "neq" || left !== "json"
			? null
			: "Ordering comparisons require scalar operands";
	}
	if (predicate.type === "and" || predicate.type === "or") {
		return (
			predicate.predicates
				.map((value) => validatePredicate(value, scope, correlatedDepth, executionScope))
				.find(Boolean) ?? null
		);
	}
	if (predicate.type === "not") {
		return validatePredicate(predicate.predicate, scope, correlatedDepth, executionScope);
	}
	if (predicate.type === "isNull" || predicate.type === "isNotNull") {
		return validateExpression(predicate.expr, scope, correlatedDepth, executionScope);
	}
	if (predicate.type === "contains") {
		const expressionError =
			validateExpression(predicate.left, scope, correlatedDepth, executionScope) ??
			validateExpression(predicate.right, scope, correlatedDepth, executionScope);
		if (expressionError) {
			return expressionError;
		}
		const left = expressionKind(predicate.left, scope);
		const right = expressionKind(predicate.right, scope);
		return (left === "text" && right === "text") || (left === "json" && right === "json")
			? null
			: "Containment operands must both be text or JSON";
	}
	const expressionError =
		validateExpression(predicate.expr, scope, correlatedDepth, executionScope) ??
		predicate.values
			.map((value) => validateExpression(value, scope, correlatedDepth, executionScope))
			.find(Boolean) ??
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
	reference: TableReference,
	executionScope: Pick<RyotQLExecutionScope, "type">,
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
	if (!canAccessCatalogTable(table, executionScope)) {
		return `Table '${reference.table}' is not available to plugin execution`;
	}
	scope.set(reference.alias, table);
	return null;
};

type QuerySet = Pick<NamedQuery, "from" | "joins" | "where"> | CorrelatedQuerySet | Include;

const expressionScope = (query: CorrelatedQuerySet, ancestors: AliasScope) => {
	const scope = new Map(ancestors);
	for (const reference of [query.from, ...(query.joins ?? []).map((join) => join.table)]) {
		const table = getCatalogTable(reference.table);
		if (table) {
			scope.set(reference.alias, table);
		}
	}
	return scope;
};

const validateQuerySet = (
	query: QuerySet,
	ancestors: AliasScope,
	correlatedDepth: number,
	executionScope: Pick<RyotQLExecutionScope, "type"> = { type: "user" },
) => {
	const joins = query.joins ?? [];
	if (joins.length > MAX_QUERY_JOINS) {
		return { error: `A query may contain at most ${MAX_QUERY_JOINS} joins`, scope: null };
	}
	const scope = new Map(ancestors);
	const rootError = addTable(scope, query.from, executionScope);
	if (rootError) {
		return { error: rootError, scope: null };
	}
	for (const join of joins) {
		const tableError = addTable(scope, join.table, executionScope);
		if (tableError) {
			return { error: tableError, scope: null };
		}
		const onError = validatePredicate(join.on, scope, correlatedDepth, executionScope);
		if (onError) {
			return { error: onError, scope: null };
		}
	}
	const whereError = query.where
		? validatePredicate(query.where, scope, correlatedDepth, executionScope)
		: null;
	return whereError ? { error: whereError, scope: null } : { error: null, scope };
};

const validateSelections = (
	fields: readonly FieldSelection[],
	orderBy: readonly OrderBy[],
	include: readonly Include[],
	scope: AliasScope,
	depth: number,
	executionScope: Pick<RyotQLExecutionScope, "type">,
): string | null => {
	const keys = new Set<string>();
	for (const field of fields) {
		const keyError = requiredNameError(field.key, "Output field key");
		if (keyError) {
			return keyError;
		}
		if (keys.has(field.key)) {
			return `Duplicate output field key '${field.key}'`;
		}
		keys.add(field.key);
		const fieldError = validateExpression(field.expr, scope, 0, executionScope);
		if (fieldError) {
			return fieldError;
		}
	}
	for (const nested of include) {
		const keyError = requiredNameError(nested.key, "Include key");
		if (keyError) {
			return keyError;
		}
		if (keys.has(nested.key)) {
			return `Duplicate output key '${nested.key}'`;
		}
		keys.add(nested.key);
		if (depth >= MAX_INCLUDE_DEPTH) {
			return `Include depth must not exceed ${MAX_INCLUDE_DEPTH}`;
		}
		if (nested.limit > MAX_INCLUDE_LIMIT) {
			return `Include limit must not exceed ${MAX_INCLUDE_LIMIT}`;
		}
		const nestedQuerySet = validateQuerySet(nested, scope, 0, executionScope);
		if (nestedQuerySet.error || !nestedQuerySet.scope) {
			return `Include '${nested.key}': ${nestedQuerySet.error}`;
		}
		const nestedError = validateSelections(
			nested.fields,
			nested.orderBy,
			nested.include ?? [],
			nestedQuerySet.scope,
			depth + 1,
			executionScope,
		);
		if (nestedError) {
			return `Include '${nested.key}': ${nestedError}`;
		}
	}
	for (const order of orderBy) {
		const expressionError = validateExpression(order.expr, scope, 0, executionScope);
		if (expressionError) {
			return expressionError;
		}
		if (expressionKind(order.expr, scope) === "json") {
			return "Ordering expressions must resolve to scalar values";
		}
	}
	return null;
};

const validateAggregateOutput = (
	output: AggregateOutput,
	scope: AliasScope,
	executionScope: Pick<RyotQLExecutionScope, "type">,
): string | null => {
	const outputKeys = new Set<string>();
	for (const group of output.groupBy ?? []) {
		const keyError = requiredNameError(group.key, "Aggregate output key");
		if (keyError) {
			return keyError;
		}
		if (outputKeys.has(group.key)) {
			return `Duplicate aggregate output key '${group.key}'`;
		}
		outputKeys.add(group.key);
		const expressionError = validateExpression(group.expr, scope, 0, executionScope);
		if (expressionError) {
			return expressionError;
		}
	}

	const measureKeys = new Set<string>();
	for (const measure of output.measures) {
		const keyError = requiredNameError(measure.key, "Aggregate output key");
		if (keyError) {
			return keyError;
		}
		if (outputKeys.has(measure.key)) {
			return `Duplicate aggregate output key '${measure.key}'`;
		}
		outputKeys.add(measure.key);
		measureKeys.add(measure.key);
		if (measure.aggregation.function !== "count") {
			const expressionError = validateExpression(
				measure.aggregation.expr,
				scope,
				0,
				executionScope,
			);
			if (expressionError) {
				return expressionError;
			}
		}
	}

	if ((output.groupBy?.length ?? 0) > 0) {
		if (output.limit === undefined) {
			return "Grouped aggregate outputs require a limit";
		}
		if (output.limit > MAX_GROUPED_AGGREGATE_LIMIT) {
			return `Grouped aggregate limit must not exceed ${MAX_GROUPED_AGGREGATE_LIMIT}`;
		}
		if (output.orderBy === undefined) {
			return "Grouped aggregate outputs require non-empty orderBy";
		}
	}

	for (const order of output.orderBy ?? []) {
		const keyError = requiredNameError(order.key, "Aggregate order key");
		if (keyError) {
			return keyError;
		}
		if (!measureKeys.has(order.key)) {
			return `Unknown aggregate measure key '${order.key}'`;
		}
	}
	return null;
};

const addTimeSeriesBucket = (
	value: DateTime.DateTime,
	bucket: TimeSeriesOutput["time"]["bucket"],
) => {
	if (bucket === "hour") {
		return DateTime.addDuration(value, Duration.hours(1));
	}
	if (bucket === "day") {
		return DateTime.addDuration(value, Duration.days(1));
	}
	if (bucket === "week") {
		return DateTime.addDuration(value, Duration.days(7));
	}
	return DateTime.add(value, { months: 1 });
};

const countTimeSeriesBuckets = (output: TimeSeriesOutput) => {
	const startAt = DateTime.make(output.time.range.startAt);
	const endAt = DateTime.make(output.time.range.endAt);
	if (Option.isNone(startAt) || Option.isNone(endAt)) {
		return { count: null, endAt, startAt };
	}
	if (!DateTime.isLessThan(startAt.value, endAt.value)) {
		return { count: null, endAt, startAt };
	}
	let count = 0;
	let cursor: DateTime.DateTime = DateTime.startOf(startAt.value, output.time.bucket, {
		weekStartsOn: 1,
	});
	const alignedEnd = addTimeSeriesBucket(
		DateTime.startOf(
			DateTime.subtractDuration(endAt.value, Duration.millis(1)),
			output.time.bucket,
			{ weekStartsOn: 1 },
		),
		output.time.bucket,
	);
	while (DateTime.isLessThan(cursor, alignedEnd) && count <= MAX_TIME_SERIES_BUCKETS) {
		count += 1;
		cursor = addTimeSeriesBucket(cursor, output.time.bucket);
	}
	return { count, endAt, startAt };
};

const validateTimeSeriesOutput = (
	output: TimeSeriesOutput,
	scope: AliasScope,
	executionScope: Pick<RyotQLExecutionScope, "type">,
): string | null => {
	const range = countTimeSeriesBuckets(output);
	if (Option.isNone(range.startAt) || Option.isNone(range.endAt)) {
		return "Time-series range startAt and endAt must be valid dates";
	}
	if (!DateTime.isLessThan(range.startAt.value, range.endAt.value)) {
		return "Time-series range startAt must be before endAt";
	}
	if (range.count !== null && range.count > MAX_TIME_SERIES_BUCKETS) {
		return `Time-series bucket count exceeds maximum of ${MAX_TIME_SERIES_BUCKETS}`;
	}
	const timeError = validateExpression(output.time.expr, scope, 0, executionScope);
	if (timeError) {
		return timeError;
	}
	const validTimeExpression =
		(output.time.expr.type === "column" && expressionKind(output.time.expr, scope) === "date") ||
		(output.time.expr.type === "cast" && output.time.expr.target === "date");
	if (!validTimeExpression) {
		return "Time-series time expressions require a date field or explicit date cast";
	}
	return output.measure.aggregation.function === "count"
		? null
		: validateExpression(output.measure.aggregation.expr, scope, 0, executionScope);
};

const validateNamedQuery = (
	query: NamedQuery,
	executionScope: Pick<RyotQLExecutionScope, "type">,
): string | null => {
	const querySet = validateQuerySet(query, new Map(), 0, executionScope);
	if (querySet.error || !querySet.scope) {
		return querySet.error;
	}
	if (query.output.type === "aggregate") {
		return validateAggregateOutput(query.output, querySet.scope, executionScope);
	}
	if (query.output.type === "timeSeries") {
		return validateTimeSeriesOutput(query.output, querySet.scope, executionScope);
	}
	if (query.output.pagination.limit > MAX_ROOT_PAGE_SIZE) {
		return `Rows limit must not exceed ${MAX_ROOT_PAGE_SIZE}`;
	}
	return validateSelections(
		query.output.fields,
		query.output.orderBy,
		query.output.include ?? [],
		querySet.scope,
		0,
		executionScope,
	);
};

export const validateRyotQLDocument = (
	document: RyotQLDocument,
	executionScope: Pick<RyotQLExecutionScope, "type"> = { type: "user" },
): string | null => {
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
		const queryError = validateNamedQuery(query, executionScope);
		if (queryError) {
			return `Query '${name}': ${queryError}`;
		}
	}
	return null;
};
