import { DateTime, Option } from "effect";

import type { IncludeEntry, QueryDocument, RowsOutput } from "../language";
import { countAlignedTimeSeriesBuckets } from "../time-series-buckets";
import { validateEntitySource, validateExpr, validateNestedEventSource } from "./core";
import {
	MAX_GROUPED_AGGREGATE_LIMIT,
	MAX_INCLUDE_DEPTH,
	MAX_INCLUDE_LIMIT,
	MAX_ROOT_PAGE_SIZE,
	MAX_TIME_SERIES_BUCKETS,
	outputKeyLengthError,
	type AliasScope,
} from "./shared";

const buildIncludeOutputScope = (include: IncludeEntry, scope: AliasScope): AliasScope | string => {
	const outputScope: AliasScope = new Map();
	const sourceEntry = scope.get(include.source.alias);
	if (sourceEntry === undefined) {
		return `Unknown source alias '${include.source.alias}'`;
	}
	outputScope.set(include.source.alias, sourceEntry);

	const attachedAlias =
		include.source.type === "events" ? include.source.entityRef : include.source.via?.alias;
	if (attachedAlias === undefined) {
		return outputScope;
	}
	const attachedEntry = scope.get(attachedAlias);
	if (attachedEntry === undefined) {
		return `Unknown source alias '${attachedAlias}'`;
	}
	outputScope.set(attachedAlias, attachedEntry);
	return outputScope;
};

const validateIncludeEntry = (
	include: IncludeEntry,
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
	if (include.source.type === "events" && (include.include?.length ?? 0) > 0) {
		return `Included event source '${include.source.alias}' does not support nested includes`;
	}
	if (include.source.type === "entities" && include.source.via === undefined) {
		return `Included entity source '${include.source.alias}' must specify via`;
	}

	const scope = new Map(parentScope);
	const sourceError =
		include.source.type === "events"
			? validateNestedEventSource(include.source, scope, aliases)
			: validateEntitySource(include.source, scope, aliases);
	if (sourceError) {
		return sourceError;
	}

	const outputScope = buildIncludeOutputScope(include, scope);
	if (typeof outputScope === "string") {
		return outputScope;
	}

	const outputKeys = new Set<string>();
	for (const field of include.fields) {
		if (outputKeys.has(field.key)) {
			return `Duplicate output field key '${field.key}'`;
		}
		const lengthError = outputKeyLengthError(field.key);
		if (lengthError) {
			return lengthError;
		}
		outputKeys.add(field.key);
	}
	for (const childInclude of include.include ?? []) {
		if (outputKeys.has(childInclude.key)) {
			return `Duplicate output field key '${childInclude.key}'`;
		}
		const lengthError = outputKeyLengthError(childInclude.key);
		if (lengthError) {
			return lengthError;
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
		const error = validateExpr(field.expr, outputScope, aliases);
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

export const validateRowsOutput = (output: RowsOutput, scope: AliasScope, aliases: AliasScope) => {
	if (output.pagination.limit > MAX_ROOT_PAGE_SIZE) {
		return `Pagination limit ${output.pagination.limit} exceeds maximum of ${MAX_ROOT_PAGE_SIZE}`;
	}

	const fieldKeys = new Set<string>();
	for (const field of output.fields) {
		if (fieldKeys.has(field.key)) {
			return `Duplicate output field key '${field.key}'`;
		}
		const lengthError = outputKeyLengthError(field.key);
		if (lengthError) {
			return lengthError;
		}
		fieldKeys.add(field.key);
	}
	for (const include of output.include ?? []) {
		if (fieldKeys.has(include.key)) {
			return `Duplicate output field key '${include.key}'`;
		}
		const lengthError = outputKeyLengthError(include.key);
		if (lengthError) {
			return lengthError;
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
		const error = validateExpr(field.expr, scope, aliases);
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
	output: Extract<QueryDocument["output"], { type: "aggregate" }>,
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
		const error = validateExpr(entry.expr, scope, aliases, 0, measureKeys);
		if (error) {
			return error;
		}
		if (entry.expr.type !== "measureRef") {
			return "Aggregate orderBy currently supports measureRef expressions only";
		}
	}

	return null;
};

export const validateTimeSeriesOutput = (
	output: Extract<QueryDocument["output"], { type: "timeSeries" }>,
	scope: AliasScope,
	aliases: AliasScope,
) => {
	const startAt = DateTime.make(output.time.range.startAt);
	const endAt = DateTime.make(output.time.range.endAt);
	if (Option.isNone(startAt) || Option.isNone(endAt)) {
		return "Time-series range startAt and endAt must be valid dates";
	}
	if (!DateTime.lessThan(startAt.value, endAt.value)) {
		return "Time-series range startAt must be before endAt";
	}

	const bucketCount = countAlignedTimeSeriesBuckets({
		endAt: endAt.value,
		startAt: startAt.value,
		bucket: output.time.bucket,
	});
	if (bucketCount > MAX_TIME_SERIES_BUCKETS) {
		return `Time-series bucket count ${bucketCount} exceeds maximum of ${MAX_TIME_SERIES_BUCKETS}`;
	}

	const timeExprError = validateExpr(output.time.expr, scope, aliases);
	if (timeExprError) {
		return timeExprError;
	}

	const aggregation = output.measure.aggregation;
	if (aggregation.function === "count") {
		return aggregation.distinctBy ? validateExpr(aggregation.distinctBy, scope, aliases) : null;
	}

	return validateExpr(aggregation.expr, scope, aliases);
};
