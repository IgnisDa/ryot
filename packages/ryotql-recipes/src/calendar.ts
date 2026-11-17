import { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { identityTupleKey } from "@ryot-app/contract/modules/plugins/references";
import { rowsResultSchema } from "@ryot-app/contract/modules/ryotql/language";
import {
	RowSourcePrecision,
	RowSourceQuery,
	RowText,
} from "@ryot-app/contract/modules/ryotql/row-source";
import { SavedViewSubject } from "@ryot-app/contract/modules/saved-views/schemas";
import { CalendarSourceSlug, PluginId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { Message } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	field,
	gte,
	join,
	lt,
	type Recipe,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

import { subjectSchemaPredicate, unusedFieldKey } from "./saved-views";

const CALENDAR_OCCURRENCE_PAGE_SIZE = 100;

const OCCURRENCES_QUERY = "calendarOccurrences";

const calendarSource = table("calendarSource", "calendarSource");
const plugin = table("plugin", "calendarSourcePlugin");

export const calendarSourcesRecipe = defineRecipe({
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
				ascending(column(calendarSource, "pluginId")),
				ascending(column(calendarSource, "slug")),
			],
			selection: {
				name: selectedField(column(calendarSource, "name"), Message),
				icon: selectedField(column(calendarSource, "icon"), Schema.String),
				pluginId: selectedField(column(calendarSource, "pluginId"), PluginId),
				query: selectedField(column(calendarSource, "query"), RowSourceQuery),
				slug: selectedField(column(calendarSource, "slug"), CalendarSourceSlug),
				startAt: selectedField(column(calendarSource, "startAt"), Schema.String),
				pluginName: selectedField(column(plugin, "name"), Schema.NullOr(Message)),
				subject: selectedField(column(calendarSource, "subject"), SavedViewSubject),
				isHidden: selectedField(column(calendarSource, "isHidden"), Schema.Boolean),
				art: selectedField(column(calendarSource, "art"), Schema.NullOr(Schema.String)),
				done: selectedField(column(calendarSource, "done"), Schema.NullOr(Schema.String)),
				precision: selectedField(column(calendarSource, "precision"), RowSourcePrecision),
				caption: selectedField(column(calendarSource, "caption"), Schema.NullOr(RowText)),
			},
		}),
	},
});

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

export const calendarWindowBounds = (precision: RowSourcePrecision, window: CalendarWindow) =>
	precision === "date"
		? { start: `${window.month}-01`, end: `${nextMonth(window.month)}-01` }
		: { end: window.localEnd, start: window.localStart };

export type CalendarOccurrence = {
	readonly key: string;
	readonly done: boolean;
	readonly startAt: string;
	readonly sourceKey: string;
	readonly caption: null | Message;
	readonly art: null | AssetLocator;
	readonly precision: RowSourcePrecision;
	readonly subject: {
		readonly id: string;
		readonly name: string;
		readonly schemaSlug: string;
		readonly owner: null | string;
	};
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

/** A caption binds each argument from its row field; a row lacking one has no caption. */
const captionValue = (row: OccurrenceRow, caption: null | RowText): null | Message => {
	if (caption === null) {
		return null;
	}
	const params: Record<string, number | string> = {};
	for (const [name, key] of Object.entries(caption.params)) {
		const value = row[key];
		if (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) {
			return null;
		}
		params[name] = value;
	}
	return { ...caption.text, params };
};

const nullableTextValue = (row: OccurrenceRow, key: string) => {
	const value = row[key];
	return value === null || typeof value === "string"
		? Result.succeed(value)
		: Result.fail(new Error(`Calendar occurrence field '${key}' must be nullable text`));
};

export const calendarOccurrencesPageRecipe = (input: { readonly source: CalendarSource }) => {
	const { source } = input;
	const fields = source.query.output.fields.flatMap((selection) =>
		"key" in selection ? [selection] : [],
	);
	const startAt = fields.find(({ key }) => key === source.startAt);
	if (startAt === undefined) {
		return Result.fail(new Error(`Calendar source '${source.slug}' does not project its start`));
	}
	const captionFields = Object.values(source.caption?.params ?? {});
	const named = new Set([source.art, source.done, source.startAt, ...captionFields]);
	const subject = table("entity", source.subject.entityAlias);
	const idKey = unusedFieldKey(fields, "__calendarSubjectId");
	const nameKey = unusedFieldKey(fields, "__calendarSubjectName");
	const ownerKey = unusedFieldKey(fields, "__calendarSubjectOwner");
	const schemaKey = unusedFieldKey(fields, "__calendarSubjectSchema");
	const recipeParameters = parameters({
		fields: {
			windowEnd: {
				validation: { required: true },
				description: "Exclusive bounded scan end",
				label: kernelMessage("recipe.parameter.window-end"),
				type: source.precision === "date" ? "date" : "datetime",
			},
			windowStart: {
				validation: { required: true },
				description: "Inclusive bounded scan start",
				label: kernelMessage("recipe.parameter.window-start"),
				type: source.precision === "date" ? "date" : "datetime",
			},
		},
	});
	const decodeRow = (row: OccurrenceRow) =>
		Result.gen(function* () {
			const start = yield* textValue(row, source.startAt);
			const subjectId = yield* textValue(row, idKey);
			const caption = captionValue(row, source.caption);
			const art = decodeArt(rowValue(row, source.art));
			return {
				caption,
				startAt: start,
				sourceKey: source.sourceKey,
				precision: source.precision,
				done: rowValue(row, source.done) === true,
				art: Result.isSuccess(art) ? art.success : null,
				key: identityTupleKey(subjectId, start, ...captionFields.map((key) => row[key] ?? null)),
				subject: {
					id: subjectId,
					name: yield* textValue(row, nameKey),
					schemaSlug: yield* textValue(row, schemaKey),
					owner: yield* nullableTextValue(row, ownerKey),
				},
			} satisfies CalendarOccurrence;
		});
	const recipe = defineRecipe({
		parameters: recipeParameters.schema,
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
						gte(startAt.expr, recipeParameters.value("windowStart")),
						lt(startAt.expr, recipeParameters.value("windowEnd")),
					),
					output: {
						...source.query.output,
						orderBy: [ascending(startAt.expr)],
						pagination: {
							limit: CALENDAR_OCCURRENCE_PAGE_SIZE,
							maxLimit: CALENDAR_OCCURRENCE_PAGE_SIZE,
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
	});
	return Result.succeed(recipe);
};
