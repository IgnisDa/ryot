import type { IncludeEntryV2, QueryDocumentV2, RowsOutputV2 } from "../language";
import { validateEntitySource, validateExpr } from "./core";
import {
	MAX_INCLUDE_DEPTH,
	MAX_INCLUDE_LIMIT,
	MAX_GROUPED_AGGREGATE_LIMIT,
	MAX_ROOT_PAGE_SIZE,
	type AliasScope,
} from "./shared";

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
		if (entry.expr.type !== "ref") {
			return "Rows orderBy currently supports ref expressions only";
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

export const validateRowsOutput = (
	output: RowsOutputV2,
	scope: AliasScope,
	aliases: AliasScope,
) => {
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
		if (entry.expr.type !== "ref") {
			return "Rows orderBy currently supports ref expressions only";
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

export const validateAggregateOutput = (
	output: Extract<QueryDocumentV2["output"], { type: "aggregate" }>,
	scope: AliasScope,
	aliases: AliasScope,
) => {
	const outputKeys = new Set<string>();
	for (const group of output.groupBy ?? []) {
		if (outputKeys.has(group.key)) {
			return `Duplicate aggregate output key '${group.key}'`;
		}
		outputKeys.add(group.key);
	}

	const measureKeys = new Set<string>();
	for (const measure of output.measures) {
		if (outputKeys.has(measure.key)) {
			return `Duplicate aggregate output key '${measure.key}'`;
		}
		outputKeys.add(measure.key);
		measureKeys.add(measure.key);
	}

	const isGrouped = (output.groupBy?.length ?? 0) > 0;
	if (isGrouped) {
		if (output.limit === undefined) {
			return "Grouped aggregate returns require a limit";
		}
		if (output.limit > MAX_GROUPED_AGGREGATE_LIMIT) {
			return `Grouped aggregate limit ${output.limit} exceeds maximum of ${MAX_GROUPED_AGGREGATE_LIMIT}`;
		}
		if (output.orderBy === undefined || output.orderBy.length === 0) {
			return "Grouped aggregate returns require non-empty orderBy";
		}
	}

	for (const group of output.groupBy ?? []) {
		const error = validateExpr(group.expr, scope, aliases);
		if (error) {
			return error;
		}
	}

	for (const measure of output.measures) {
		const aggregation = measure.aggregation;
		if (aggregation.function === "count") {
			if (aggregation.distinctBy === undefined) {
				continue;
			}
			const error = validateExpr(aggregation.distinctBy, scope, aliases);
			if (error) {
				return error;
			}
			continue;
		}

		const error = validateExpr(aggregation.expr, scope, aliases);
		if (error) {
			return error;
		}
	}

	for (const entry of output.orderBy ?? []) {
		const error = validateExpr(entry.expr, scope, aliases, 0, false, measureKeys);
		if (error) {
			return error;
		}
		if (entry.expr.type !== "measureRef") {
			return "Aggregate orderBy currently supports measureRef expressions only";
		}
	}

	return null;
};
