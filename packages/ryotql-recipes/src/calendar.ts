import { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import {
	CalendarSourcePrecision,
	CalendarSourceQuery,
} from "@ryot-app/contract/modules/calendar-sources/schemas";
import { identityTupleKey } from "@ryot-app/contract/modules/plugins/references";
import { rowsResultSchema } from "@ryot-app/contract/modules/ryotql/language";
import { SavedViewSubject } from "@ryot-app/contract/modules/saved-views/schemas";
import { CalendarSourceSlug, PluginId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import {
	and,
	ascending,
	castDate,
	column,
	defineRecipe,
	eq,
	field,
	gte,
	join,
	literal,
	lt,
	type PreparedRecipe,
	type Recipe,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import { subjectSchemaPredicate, unusedFieldKey } from "./saved-views";

const CALENDAR_OCCURRENCE_PAGE_SIZE = 100;

const OCCURRENCES_QUERY = "calendarOccurrences";

const calendarSource = table("calendarSource", "calendarSource");
const plugin = table("plugin", "calendarSourcePlugin");

export const calendarSourcesRecipe = defineRecipe(() => ({
	map: ({ calendarSources }) =>
		Result.succeed(
			calendarSources.items.map((source) => ({
				...source,
				sourceKey: identityTupleKey(source.pluginId, source.slug),
			})),
		),
	queries: {
		calendarSources: selectedRows(calendarSource, {
			limit: 100,
			joins: [join("inner", plugin, eq(column(plugin, "id"), column(calendarSource, "pluginId")))],
			orderBy: [
				ascending(column(plugin, "name")),
				ascending(column(calendarSource, "name")),
				ascending(column(calendarSource, "pluginId")),
				ascending(column(calendarSource, "slug")),
			],
			selection: {
				name: selectedField(column(calendarSource, "name"), Schema.String),
				icon: selectedField(column(calendarSource, "icon"), Schema.String),
				pluginId: selectedField(column(calendarSource, "pluginId"), PluginId),
				slug: selectedField(column(calendarSource, "slug"), CalendarSourceSlug),
				startAt: selectedField(column(calendarSource, "startAt"), Schema.String),
				query: selectedField(column(calendarSource, "query"), CalendarSourceQuery),
				subject: selectedField(column(calendarSource, "subject"), SavedViewSubject),
				isHidden: selectedField(column(calendarSource, "isHidden"), Schema.Boolean),
				pluginName: selectedField(column(plugin, "name"), Schema.NullOr(Schema.String)),
				art: selectedField(column(calendarSource, "art"), Schema.NullOr(Schema.String)),
				done: selectedField(column(calendarSource, "done"), Schema.NullOr(Schema.String)),
				precision: selectedField(column(calendarSource, "precision"), CalendarSourcePrecision),
				caption: selectedField(column(calendarSource, "caption"), Schema.NullOr(Schema.String)),
			},
		}),
	},
}));

export type CalendarSource = Recipe.Success<typeof calendarSourcesRecipe>[number];

export type CalendarWindow = {
	readonly month: string;
	readonly localEnd: string;
	readonly localStart: string;
};

const nextMonth = (month: string) => {
	const [year = 0, index = 1] = month.split("-").map(Number);
	return index === 12
		? `${String(year + 1).padStart(4, "0")}-01`
		: `${String(year).padStart(4, "0")}-${String(index + 1).padStart(2, "0")}`;
};

const calendarWindowBounds = (precision: CalendarSourcePrecision, window: CalendarWindow) =>
	precision === "date"
		? {
				start: `${window.month}-01T00:00:00.000Z`,
				end: `${nextMonth(window.month)}-01T00:00:00.000Z`,
			}
		: { end: window.localEnd, start: window.localStart };

export type CalendarOccurrence = {
	readonly key: string;
	readonly done: boolean;
	readonly startAt: string;
	readonly sourceKey: string;
	readonly caption: null | string;
	readonly art: null | AssetLocator;
	readonly precision: CalendarSourcePrecision;
	readonly subject: {
		readonly id: string;
		readonly name: string;
		readonly schemaSlug: string;
		readonly owner: null | string;
	};
};

type CalendarOccurrencePage = {
	readonly items: readonly CalendarOccurrence[];
	readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: null | string };
};

const occurrenceRows = rowsResultSchema(Schema.Record(Schema.String, JsonValue));
const decodeArt = Schema.decodeUnknownResult(AssetLocator);

type OccurrenceRow = Readonly<Record<string, JsonValue>>;

const rowValue = (row: OccurrenceRow, key: null | string) =>
	key === null ? null : (row[key] ?? null);

const textValue = (row: OccurrenceRow, key: string) => {
	const value = row[key];
	return typeof value === "string"
		? Result.succeed(value)
		: Result.fail(new Error(`Calendar occurrence field '${key}' must be text`));
};

const nullableTextValue = (row: OccurrenceRow, key: string) => {
	const value = row[key];
	return value === null || typeof value === "string"
		? Result.succeed(value)
		: Result.fail(new Error(`Calendar occurrence field '${key}' must be nullable text`));
};

export const calendarOccurrencesPageRecipe = (input: {
	readonly source: CalendarSource;
	readonly window: CalendarWindow;
	readonly after?: string | undefined;
}): Result.Result<PreparedRecipe<CalendarOccurrencePage>, Error> => {
	const { source } = input;
	const fields = source.query.output.fields.flatMap((selection) =>
		"key" in selection ? [selection] : [],
	);
	const startAt = fields.find(({ key }) => key === source.startAt);
	if (startAt === undefined) {
		return Result.fail(new Error(`Calendar source '${source.slug}' does not project its start`));
	}
	const named = new Set([source.art, source.done, source.startAt, source.caption]);
	const subject = table("entity", source.subject.entityAlias);
	const idKey = unusedFieldKey(fields, "__calendarSubjectId");
	const nameKey = unusedFieldKey(fields, "__calendarSubjectName");
	const ownerKey = unusedFieldKey(fields, "__calendarSubjectOwner");
	const schemaKey = unusedFieldKey(fields, "__calendarSubjectSchema");
	const bounds = calendarWindowBounds(source.precision, input.window);
	const decodeRow = (row: OccurrenceRow) =>
		Result.gen(function* () {
			const start = yield* textValue(row, source.startAt);
			const subjectId = yield* textValue(row, idKey);
			const caption = rowValue(row, source.caption);
			const art = decodeArt(rowValue(row, source.art));
			return {
				startAt: start,
				sourceKey: source.sourceKey,
				precision: source.precision,
				done: rowValue(row, source.done) === true,
				art: Result.isSuccess(art) ? art.success : null,
				key: identityTupleKey(subjectId, start, caption),
				caption: typeof caption === "string" ? caption : null,
				subject: {
					id: subjectId,
					name: yield* textValue(row, nameKey),
					schemaSlug: yield* textValue(row, schemaKey),
					owner: yield* nullableTextValue(row, ownerKey),
				},
			} satisfies CalendarOccurrence;
		});
	const recipe = defineRecipe(() => ({
		map: (results) => Result.succeed(results[OCCURRENCES_QUERY]),
		queries: {
			[OCCURRENCES_QUERY]: {
				decodeResult: (result: unknown) =>
					Result.flatMap(
						Schema.decodeUnknownResult(occurrenceRows)(result),
						({ items, pageInfo }) =>
							Result.map(Result.all(items.map(decodeRow)), (decoded) => ({
								items: decoded,
								pageInfo: { hasMore: pageInfo.hasMore, nextCursor: pageInfo.nextCursor },
							})),
					),
				document: {
					...source.query,
					where: and(
						...(source.query.where === undefined ? [] : [source.query.where]),
						subjectSchemaPredicate(source.subject, subject),
						gte(startAt.expr, castDate(literal(bounds.start))),
						lt(startAt.expr, castDate(literal(bounds.end))),
					),
					output: {
						...source.query.output,
						orderBy: [ascending(startAt.expr)],
						pagination: {
							limit: CALENDAR_OCCURRENCE_PAGE_SIZE,
							...(input.after === undefined ? {} : { after: input.after }),
						},
						fields: [
							...fields.filter(({ key }) => named.has(key)),
							field(idKey, column(subject, "id")),
							field(nameKey, column(subject, "name")),
							field(ownerKey, column(subject, "entitySchemaPluginId")),
							field(schemaKey, column(subject, "entitySchemaSlug")),
						],
					},
				},
			},
		},
	}));
	return Result.succeed(recipe());
};
