import { Effect } from "effect";

import type { CurrentDb } from "#lib/db";
import type { BadRequest, DbError, NotFound } from "#lib/errors";

import type { AggregateResponse, RowItem, RowValue, RowsResponse } from "../language";
import {
	evalAggregateGroupFields,
	evalAggregateMeasure,
	evalExprAsBoolean,
	groupKeyFromValues,
	sortAggregateItems,
} from "./expr";
import { executeRowsQuery as runRowsQuery } from "./rows";
import { executeRootSourceMatches } from "./source-matches";
import { executeTimeSeriesQuery as runTimeSeriesQuery } from "./time-series";
import type { AggregateQueryDocument, RowsQueryDocument, TimeSeriesQueryDocument } from "./types";

export const executeAggregateQuery = (
	userId: string,
	doc: AggregateQueryDocument,
): Effect.Effect<AggregateResponse, BadRequest | NotFound | DbError, CurrentDb> =>
	Effect.gen(function* () {
		const { output } = doc;
		const matches = yield* executeRootSourceMatches(userId, doc.source, evalExprAsBoolean);
		const groupBy = output.groupBy ?? [];

		if (groupBy.length === 0) {
			const item: Record<string, RowValue> = {};
			for (const measure of output.measures) {
				item[measure.key] = yield* evalAggregateMeasure(userId, matches, measure.aggregation);
			}
			return { type: "aggregate" as const, data: { items: [item] } };
		}

		const groups = new Map<string, { item: Record<string, RowValue>; matches: typeof matches }>();
		for (const match of matches) {
			const groupValues = yield* evalAggregateGroupFields(userId, groupBy, match);
			const groupKey = groupKeyFromValues(groupValues);
			const existing = groups.get(groupKey);
			if (existing !== undefined) {
				existing.matches.push(match);
				continue;
			}

			const item: Record<string, RowValue> = {};
			for (const [index, field] of groupBy.entries()) {
				const value = groupValues[index];
				if (value !== undefined) {
					item[field.key] = value;
				}
			}
			groups.set(groupKey, { item, matches: [match] });
		}

		const items: RowItem[] = [];
		for (const group of groups.values()) {
			for (const measure of output.measures) {
				group.item[measure.key] = yield* evalAggregateMeasure(
					userId,
					group.matches,
					measure.aggregation,
				);
			}
			items.push(group.item);
		}

		const sortedItems = sortAggregateItems(items, output.orderBy);
		const limit = output.limit ?? sortedItems.length;
		return {
			type: "aggregate" as const,
			data: {
				items: sortedItems.slice(0, limit),
				pageInfo: { limit, hasMore: sortedItems.length > limit },
			},
		};
	});

export const executeRowsQuery = (
	userId: string,
	doc: RowsQueryDocument,
): Effect.Effect<RowsResponse, BadRequest | NotFound | DbError, CurrentDb> =>
	runRowsQuery(userId, doc);

export const executeTimeSeriesQuery = (userId: string, doc: TimeSeriesQueryDocument) =>
	runTimeSeriesQuery(userId, doc);
