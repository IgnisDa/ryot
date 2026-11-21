import type { Predicate } from "@ryot-app/contract/modules/ryotql/authored";
import { rowsResultSchema } from "@ryot-app/contract/modules/ryotql/language";
import type { RowSourceQuery } from "@ryot-app/contract/modules/ryotql/row-source";
import type { SavedViewSubject } from "@ryot-app/contract/modules/saved-views/schemas";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	and,
	ascending,
	column,
	defineRecipe,
	field,
	gte,
	isNull,
	lt,
	or,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

import { subjectSchemaPredicate, unusedFieldKey } from "./saved-views";

const DUE_QUERY = "signalScheduleDue";
const NEXT_QUERY = "signalScheduleNext";

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

const dueRows = rowsResultSchema(Schema.Record(Schema.String, JsonValue));

const textValue = (row: DueRow, key: string) => {
	const value = row[key];
	return typeof value === "string"
		? Result.succeed(value)
		: Result.fail(new Error(`Signal schedule field '${key}' must be text`));
};

/**
 * `signalScheduleDue` pages the fresh occurrences due in `[start, end)`; `signalScheduleNext` is the
 * earliest fresh `dueAt` at or after `end`, null when there is none.
 */
export const signalScheduleRecipe = (input: { readonly schedule: SignalScheduleSource }) => {
	const { schedule } = input;
	const recipeParameters = parameters({
		fields: {
			confirmedAfter: {
				type: "datetime",
				description: "Freshness boundary",
				label: kernelMessage("recipe.parameter.confirmed-after"),
			},
			end: {
				type: "datetime",
				validation: { required: true },
				description: "Exclusive bounded scan end",
				label: kernelMessage("recipe.parameter.end"),
			},
			start: {
				type: "datetime",
				validation: { required: true },
				description: "Inclusive bounded scan start",
				label: kernelMessage("recipe.parameter.start"),
			},
		},
	});
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
	const dueAtKey = unusedFieldKey(fields, "__scheduleDueAt");
	const propertyKeys = new Set(Object.values(schedule.properties));
	const where = (...window: readonly Predicate[]) =>
		and(
			...(schedule.query.where === undefined ? [] : [schedule.query.where]),
			subjectSchemaPredicate(schedule.subject, subject),
			...window,
			...(confirmedAt === null
				? []
				: [
						recipeParameters.whenSet(
							"confirmedAfter",
							or(isNull(confirmedAt), gte(confirmedAt, recipeParameters.value("confirmedAfter"))),
						),
					]),
		);
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
	const recipe = defineRecipe({
		parameters: recipeParameters.schema,
		queries: {
			[NEXT_QUERY]: {
				decodeResult: (result: unknown) =>
					Result.flatMap(Schema.decodeUnknownResult(dueRows)(result), ({ items: [row] }) =>
						row === undefined ? Result.succeed(null) : textValue(row, dueAtKey),
					),
				document: {
					...schedule.query,
					where: where(gte(dueAt, recipeParameters.value("end"))),
					output: {
						type: "rows",
						orderBy: [ascending(dueAt)],
						fields: [field(dueAtKey, dueAt)],
						pagination: { limit: 1, maxLimit: 1 },
					},
				},
			},
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
					where: where(
						gte(dueAt, recipeParameters.value("start")),
						lt(dueAt, recipeParameters.value("end")),
					),
					output: {
						...schedule.query.output,
						pagination: { limit: 100, maxLimit: 1000 },
						orderBy: [ascending(dueAt), ascending(occurrence)],
						fields: [
							...fields.filter(({ key }) => propertyKeys.has(key)),
							field(idKey, column(subject, "id")),
							field(occurrenceKey, occurrence),
						],
					},
				},
			},
		},
	});
	return Result.succeed(recipe);
};
