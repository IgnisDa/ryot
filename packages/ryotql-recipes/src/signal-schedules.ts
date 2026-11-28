import {
	Join,
	Predicate,
	type ScalarExpression,
	TableReference,
	visitAuthoredNodes,
} from "@ryot-app/contract/modules/ryotql/authored";
import { rowsResultSchema } from "@ryot-app/contract/modules/ryotql/language";
import type { RowSourceQuery } from "@ryot-app/contract/modules/ryotql/row-source";
import type { SavedViewSubject } from "@ryot-app/contract/modules/saved-views/schemas";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	and,
	ascending,
	coalesce,
	column,
	defineRecipe,
	field,
	gte,
	isNull,
	or,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { everySchemaFields, getCatalogTable } from "@ryot-app/ryotql/catalog";
import { Option, Result, Schema } from "effect";

import {
	rowSourceDateWindow,
	rowSourceInstantWindow,
	rowSourceTimeWindow,
} from "./row-source-time";
import { subjectSchemaPredicate, unusedFieldKey } from "./saved-views";

const DUE_QUERY = "signalScheduleDue";
const NEXT_QUERY = "signalScheduleNext";
const NEXT_INSTANT_QUERY = "signalScheduleNextInstant";

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
	readonly instantAt?: null | string;
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
 * `signalScheduleDue` pages the fresh occurrences due in `[start, end)`, or, for a row with an
 * `instantAt` value, in `[instantStart, instantEnd)`. `signalScheduleNext` is the earliest fresh
 * `dueAt` in `[end, horizon)` of a row without an instant, null when there is none. A schedule that
 * binds `instantAt` also has `signalScheduleNextInstant`, the earliest fresh instant in
 * `[instantEnd, instantHorizon)`. Closed ranges let these queries start from an index on `dueAt`.
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
			horizon: {
				type: "datetime",
				validation: { required: true },
				label: kernelMessage("recipe.parameter.end"),
				description: "Exclusive end of the look-ahead for the next due row",
			},
			instantEnd: {
				...(schedule.instantAt != null ? { validation: { required: true as const } } : {}),
				type: "datetime",
				label: kernelMessage("recipe.parameter.end"),
				description: "Exclusive scan end for timed rows",
			},
			instantStart: {
				...(schedule.instantAt != null ? { validation: { required: true as const } } : {}),
				type: "datetime",
				label: kernelMessage("recipe.parameter.start"),
				description: "Inclusive scan start for timed rows",
			},
			instantHorizon: {
				...(schedule.instantAt != null ? { validation: { required: true as const } } : {}),
				type: "datetime",
				label: kernelMessage("recipe.parameter.end"),
				description: "Exclusive end of the look-ahead for the next timed row",
			},
		},
	});
	const fields = schedule.query.output.fields.flatMap((selection) =>
		"key" in selection ? [selection] : [],
	);
	const expression = (key: string) => fields.find((selection) => selection.key === key)?.expr;
	const dueAt = expression(schedule.dueAt);
	const instantAt = schedule.instantAt == null ? null : expression(schedule.instantAt);
	const occurrence = expression(schedule.occurrence);
	const confirmedAt = schedule.freshness ? expression(schedule.freshness.confirmedAt) : null;
	if (!dueAt || !occurrence || confirmedAt === undefined || instantAt === undefined) {
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
	const nextQuery = (at: ScalarExpression, window: readonly Predicate[]) => ({
		decodeResult: (result: unknown) =>
			Result.flatMap(Schema.decodeUnknownResult(dueRows)(result), ({ items: [row] }) =>
				row === undefined ? Result.succeed(null) : textValue(row, dueAtKey),
			),
		document: {
			...schedule.query,
			where: where(...window),
			output: {
				type: "rows" as const,
				orderBy: [ascending(at)],
				fields: [field(dueAtKey, at)],
				pagination: { limit: 1, maxLimit: 1 },
			},
		},
	});
	const recipe = defineRecipe({
		parameters: recipeParameters.schema,
		queries: {
			[NEXT_QUERY]: nextQuery(dueAt, [
				...(instantAt === null ? [] : [isNull(instantAt)]),
				...rowSourceDateWindow(dueAt, {
					start: recipeParameters.value("end"),
					end: recipeParameters.value("horizon"),
				}),
			]),
			...(instantAt === null
				? {}
				: {
						[NEXT_INSTANT_QUERY]: nextQuery(
							instantAt,
							rowSourceInstantWindow(dueAt, {
								at: instantAt,
								bounds: {
									start: recipeParameters.value("instantEnd"),
									end: recipeParameters.value("instantHorizon"),
								},
							}),
						),
					}),
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
						...rowSourceTimeWindow(
							dueAt,
							{ end: recipeParameters.value("end"), start: recipeParameters.value("start") },
							instantAt === null
								? null
								: {
										at: instantAt,
										bounds: {
											end: recipeParameters.value("instantEnd"),
											start: recipeParameters.value("instantStart"),
										},
									},
						),
					),
					output: {
						...schedule.query.output,
						pagination: { limit: 100, maxLimit: 1000 },
						orderBy: [
							ascending(instantAt === null ? dueAt : coalesce(instantAt, dueAt)),
							ascending(occurrence),
						],
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

const QuerySet = Schema.Struct({
	from: TableReference,
	where: Schema.optional(Predicate),
	joins: Schema.optional(Schema.Array(Join)),
});
type QuerySet = typeof QuerySet.Type;

const textLiteral = (expression: ScalarExpression) =>
	expression.type === "literal" && typeof expression.value === "string"
		? expression.value
		: undefined;

const isColumn = (expression: ScalarExpression, alias: string, name: string) =>
	expression.type === "column" && expression.tableAlias === alias && expression.field === name;

const columnValue = (
	left: ScalarExpression,
	right: ScalarExpression,
	alias: string,
	name: string,
) => (isColumn(left, alias, name) ? textLiteral(right) : undefined);

/** The values a predicate that holds for every result row allows `alias.name` to take, if bounded. */
const allowedValues = (
	predicate: Predicate,
	alias: string,
	name: string,
): undefined | ReadonlySet<string> => {
	if (predicate.type === "comparison") {
		const value =
			predicate.operator === "eq"
				? (columnValue(predicate.left, predicate.right, alias, name) ??
					columnValue(predicate.right, predicate.left, alias, name))
				: undefined;
		return value === undefined ? undefined : new Set([value]);
	}
	if (predicate.type === "in") {
		if ("type" in predicate.values || !isColumn(predicate.expr, alias, name)) {
			return undefined;
		}
		const values = predicate.values.map(textLiteral);
		return values.every((value): value is string => value !== undefined)
			? new Set(values)
			: undefined;
	}
	if (predicate.type === "and") {
		const bounded = predicate.predicates.flatMap((child) => {
			const values = allowedValues(child, alias, name);
			return values === undefined ? [] : [values];
		});
		const [first, ...rest] = bounded;
		return first === undefined
			? undefined
			: new Set([...first].filter((value) => rest.every((values) => values.has(value))));
	}
	if (predicate.type === "or") {
		const branches = predicate.predicates.map((child) => allowedValues(child, alias, name));
		return branches.length > 0 && branches.every((values) => values !== undefined)
			? new Set(branches.flatMap((values) => Array.from(values)))
			: undefined;
	}
	return undefined;
};

/**
 * The schemas whose global rows a query set's tables can read, or null when a table's are not
 * bounded. A table's rows are bounded by its query set's `where` and inner join conditions, and by
 * its own condition when left joined; a table whose rows are never global reads none.
 */
const querySetSchemas = ({ from, where, joins = [] }: QuerySet): null | ReadonlySet<string> => {
	const shared = [
		...(where === undefined ? [] : [where]),
		...joins.flatMap((join) => (join.type === "inner" ? [join.on] : [])),
	];
	const tables: ReadonlyArray<{
		readonly source: TableReference;
		readonly own: readonly Predicate[];
	}> = [
		{ own: [], source: from },
		...joins.flatMap((join) =>
			join.type === "jsonElements"
				? []
				: [{ source: join.table, own: join.type === "left" ? [join.on] : [] }],
		),
	];
	const schemas = new Set<string>();
	for (const { own, source } of tables) {
		const dataChanges = "table" in source ? getCatalogTable(source.table)?.dataChanges : undefined;
		if (dataChanges === undefined) {
			return null;
		}
		if (dataChanges.globalSchemaField === undefined) {
			continue;
		}
		const allowed = allowedValues(
			{ type: "and", predicates: [...shared, ...own] },
			source.alias,
			dataChanges.globalSchemaField,
		);
		if (allowed === undefined) {
			return null;
		}
		for (const slug of allowed) {
			schemas.add(slug);
		}
	}
	return schemas;
};

const documentReads = (value: unknown) => {
	const reads: Array<null | ReadonlySet<string>> = [];
	visitAuthoredNodes(value, (node) => {
		if (
			node["type"] === "column" &&
			typeof node["field"] === "string" &&
			everySchemaFields.has(node["field"])
		) {
			reads.push(null);
			return;
		}
		const querySet = Schema.decodeUnknownOption(QuerySet)(node);
		if (Option.isSome(querySet)) {
			reads.push(querySetSchemas(querySet.value));
		}
	});
	return reads;
};

/**
 * The schema slugs of the global rows a schedule's evaluation can read, sorted, or null when they
 * are not bounded. A global row of another schema cannot change what the evaluation returns.
 */
export const signalScheduleReadSchemaSlugs = (schedule: SignalScheduleSource) =>
	Result.map(signalScheduleRecipe({ schedule }), (recipe) => {
		const reads = documentReads(recipe.document.queries);
		return reads.every((read) => read !== null)
			? [...new Set(reads.flatMap((read) => Array.from(read)))].sort()
			: null;
	});
