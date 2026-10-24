import { rowsResultSchema } from "@ryot-app/contract/modules/ryotql/language";
import type { RowSourceQuery } from "@ryot-app/contract/modules/ryotql/row-source";
import type { SavedViewSubject } from "@ryot-app/contract/modules/saved-views/schemas";
import { JsonValue } from "@ryot-app/contract/schema/json";
import {
	and,
	ascending,
	castDate,
	column,
	defineRecipe,
	field,
	gte,
	isNull,
	literal,
	lt,
	or,
	type PreparedRecipe,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import { subjectSchemaPredicate, unusedFieldKey } from "./saved-views";

const DUE_QUERY = "signalScheduleDue";

export type SignalScheduleCandidate = {
	readonly subjectId: string;
	readonly occurrence: string;
	readonly properties: Readonly<Record<string, JsonValue>>;
};

export type SignalScheduleSource = {
	readonly slug: string;
	readonly dueAt: string;
	readonly occurrence: string;
	readonly query: RowSourceQuery;
	readonly subject: SavedViewSubject;
	readonly properties: Readonly<Record<string, string>>;
	readonly freshness: null | { readonly confirmedAt: string };
};

type DueRow = Readonly<Record<string, JsonValue>>;

type SignalScheduleBounds = {
	readonly end: string;
	readonly start: string;
	readonly confirmedAfter: null | string;
};

type SignalSchedulePage = {
	readonly items: readonly SignalScheduleCandidate[];
	readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: null | string };
};

const dueRows = rowsResultSchema(Schema.Record(Schema.String, JsonValue));

const textValue = (row: DueRow, key: string) => {
	const value = row[key];
	return typeof value === "string"
		? Result.succeed(value)
		: Result.fail(new Error(`Signal schedule field '${key}' must be text`));
};

export const signalSchedulePageRecipe = (input: {
	readonly limit: number;
	readonly after?: string | undefined;
	readonly bounds: SignalScheduleBounds;
	readonly schedule: SignalScheduleSource;
}): Result.Result<PreparedRecipe<SignalSchedulePage>, Error> => {
	const { schedule } = input;
	const fields = schedule.query.output.fields.flatMap((selection) =>
		"key" in selection ? [selection] : [],
	);
	const expression = (key: string) => fields.find((selection) => selection.key === key)?.expr;
	const dueAt = expression(schedule.dueAt);
	const occurrence = expression(schedule.occurrence);
	const confirmedAt = schedule.freshness ? expression(schedule.freshness.confirmedAt) : null;
	if (!dueAt || !occurrence || confirmedAt === undefined) {
		return Result.fail(new Error(`Signal schedule '${schedule.slug}' does not project its fields`));
	}
	const subject = table("entity", schedule.subject.entityAlias);
	const idKey = unusedFieldKey(fields, "__scheduleSubjectId");
	const occurrenceKey = unusedFieldKey(fields, "__scheduleOccurrence");
	const propertyKeys = new Set(Object.values(schedule.properties));
	const decodeRow = (row: DueRow) =>
		Result.gen(function* () {
			const properties: Record<string, JsonValue> = {};
			for (const [property, key] of Object.entries(schedule.properties)) {
				const value = row[key];
				if (value !== undefined && value !== null) {
					properties[property] = value;
				}
			}
			return {
				properties,
				subjectId: yield* textValue(row, idKey),
				occurrence: yield* textValue(row, occurrenceKey),
			} satisfies SignalScheduleCandidate;
		});
	const recipe = defineRecipe(() => ({
		map: (results) => Result.succeed(results[DUE_QUERY]),
		queries: {
			[DUE_QUERY]: {
				decodeResult: (result: unknown) =>
					Result.flatMap(Schema.decodeUnknownResult(dueRows)(result), ({ items, pageInfo }) =>
						Result.map(Result.all(items.map(decodeRow)), (decoded) => ({
							items: decoded,
							pageInfo: { hasMore: pageInfo.hasMore, nextCursor: pageInfo.nextCursor },
						})),
					),
				document: {
					...schedule.query,
					output: {
						...schedule.query.output,
						orderBy: [ascending(dueAt), ascending(occurrence)],
						pagination: {
							limit: input.limit,
							...(input.after === undefined ? {} : { after: input.after }),
						},
						fields: [
							...fields.filter(({ key }) => propertyKeys.has(key)),
							field(idKey, column(subject, "id")),
							field(occurrenceKey, occurrence),
						],
					},
					where: and(
						...(schedule.query.where === undefined ? [] : [schedule.query.where]),
						subjectSchemaPredicate(schedule.subject, subject),
						gte(dueAt, castDate(literal(input.bounds.start))),
						lt(dueAt, castDate(literal(input.bounds.end))),
						...(confirmedAt === null || input.bounds.confirmedAfter === null
							? []
							: [
									or(
										isNull(confirmedAt),
										gte(confirmedAt, castDate(literal(input.bounds.confirmedAfter))),
									),
								]),
					),
				},
			},
		},
	}));
	return Result.succeed(recipe());
};
