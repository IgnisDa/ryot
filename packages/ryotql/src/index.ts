import type {
	AggregateMeasure,
	AggregateOrderBy,
	AggregateOutput,
	AggregationSpec,
	ColumnExpression,
	CorrelatedQuerySet,
	ExistsExpression,
	FieldSelection,
	Include,
	IncludeResult,
	Join,
	JsonValue,
	LiteralExpression,
	NamedQuery,
	OrderBy,
	Predicate,
	RyotQLDocument,
	RowSelection,
	RowsOutput,
	RowsResult,
	ScalarExpression,
	TableReference,
	TimeSeriesOutput,
	WildcardSelection,
} from "@ryot-app/contract/modules/ryotql/language";
import { Result, Schema } from "effect";

type CastExpression = Extract<ScalarExpression, { type: "cast" }>;
type FirstExpression = Extract<ScalarExpression, { type: "first" }>;
type ComparisonPredicate = Extract<Predicate, { type: "comparison" }>;
type JsonPathExpression = Extract<ScalarExpression, { type: "jsonPath" }>;
type AggregateExpression = Extract<ScalarExpression, { type: "aggregate" }>;
type TransformExpression = Extract<ScalarExpression, { type: "transform" }>;
type ArithmeticExpression = Extract<ScalarExpression, { type: "arithmetic" }>;
type DateBucketExpression = Extract<ScalarExpression, { type: "dateBucket" }>;
type ConditionalExpression = Extract<ScalarExpression, { type: "conditional" }>;
type CorrelatedQueryInput = {
	readonly where?: Predicate | undefined;
	readonly joins?: readonly Join[] | undefined;
};

const isNonEmpty = <T>(values: readonly T[] | undefined): values is readonly [T, ...T[]] =>
	values !== undefined && values.length > 0;

export const table = (tableName: string, alias: string): TableReference => ({
	alias,
	table: tableName,
});

export const column = (tableName: TableReference, field: string): ColumnExpression => ({
	field,
	type: "column",
	tableAlias: tableName.alias,
});

const assertFiniteNumbers = (value: JsonValue) => {
	if (typeof value === "number" && !Number.isFinite(value)) {
		throw new TypeError("RyotQL literals require finite numbers");
	}
	if (Array.isArray(value)) {
		value.forEach(assertFiniteNumbers);
	} else if (value !== null && typeof value === "object") {
		Object.values(value).forEach(assertFiniteNumbers);
	}
};

export const literal = (value: JsonValue): LiteralExpression => {
	assertFiniteNumbers(value);
	return { value, type: "literal" };
};

export const jsonPath = (
	expr: ScalarExpression,
	...path: JsonPathExpression["path"]
): JsonPathExpression => ({ expr, path, type: "jsonPath" });

const cast = (target: CastExpression["target"], expr: ScalarExpression): CastExpression => ({
	expr,
	target,
	type: "cast",
});

export const castText = (expr: ScalarExpression) => cast("text", expr);
export const castDate = (expr: ScalarExpression) => cast("date", expr);
export const castJson = (expr: ScalarExpression) => cast("json", expr);
export const castNumber = (expr: ScalarExpression) => cast("number", expr);
export const castBoolean = (expr: ScalarExpression) => cast("boolean", expr);

export const dateBucket = (
	expr: ScalarExpression,
	input: Pick<DateBucketExpression, "bucket" | "timeZone">,
): DateBucketExpression => ({ expr, type: "dateBucket", ...input });

export const coalesce = (
	first: ScalarExpression,
	...rest: readonly ScalarExpression[]
): Extract<ScalarExpression, { type: "coalesce" }> => ({
	type: "coalesce",
	values: [first, ...rest],
});

export const concat = (
	first: ScalarExpression,
	...rest: readonly ScalarExpression[]
): Extract<ScalarExpression, { type: "concat" }> => ({ type: "concat", values: [first, ...rest] });

export const conditional = (
	condition: Predicate,
	whenTrue: ScalarExpression,
	whenFalse: ScalarExpression,
): ConditionalExpression => ({ whenTrue, condition, whenFalse, type: "conditional" });

export const transform = (
	name: TransformExpression["name"],
	expr: ScalarExpression,
): TransformExpression => ({ expr, name, type: "transform" });

export const kebabCase = (expr: ScalarExpression) => transform("kebabCase", expr);
export const titleCase = (expr: ScalarExpression) => transform("titleCase", expr);

export const floor = (expr: ScalarExpression): Extract<ScalarExpression, { type: "floor" }> => ({
	expr,
	type: "floor",
});
export const integer = (
	expr: ScalarExpression,
): Extract<ScalarExpression, { type: "integer" }> => ({ expr, type: "integer" });
export const round = (expr: ScalarExpression): Extract<ScalarExpression, { type: "round" }> => ({
	expr,
	type: "round",
});

const arithmetic = (
	operator: ArithmeticExpression["operator"],
	left: ScalarExpression,
	right: ScalarExpression,
): ArithmeticExpression => ({ left, right, operator, type: "arithmetic" });

export const add = (left: ScalarExpression, right: ScalarExpression) =>
	arithmetic("add", left, right);
export const divide = (left: ScalarExpression, right: ScalarExpression) =>
	arithmetic("divide", left, right);
export const multiply = (left: ScalarExpression, right: ScalarExpression) =>
	arithmetic("multiply", left, right);
export const subtract = (left: ScalarExpression, right: ScalarExpression) =>
	arithmetic("subtract", left, right);

const comparison = (
	operator: ComparisonPredicate["operator"],
	left: ScalarExpression,
	right: ScalarExpression,
): ComparisonPredicate => ({ left, right, operator, type: "comparison" });

export const eq = (left: ScalarExpression, right: ScalarExpression) =>
	comparison("eq", left, right);
export const gt = (left: ScalarExpression, right: ScalarExpression) =>
	comparison("gt", left, right);
export const gte = (left: ScalarExpression, right: ScalarExpression) =>
	comparison("gte", left, right);
export const lt = (left: ScalarExpression, right: ScalarExpression) =>
	comparison("lt", left, right);
export const lte = (left: ScalarExpression, right: ScalarExpression) =>
	comparison("lte", left, right);
export const neq = (left: ScalarExpression, right: ScalarExpression) =>
	comparison("neq", left, right);

export const inArray = (
	expr: ScalarExpression,
	values: readonly ScalarExpression[],
): Predicate => ({ expr, type: "in", values: [...values] });

export const contains = (left: ScalarExpression, right: ScalarExpression): Predicate => ({
	left,
	right,
	type: "contains",
});

export const isNull = (expr: ScalarExpression): Predicate => ({ expr, type: "isNull" });
export const isNotNull = (expr: ScalarExpression): Extract<Predicate, { type: "isNotNull" }> => ({
	expr,
	type: "isNotNull",
});
export const not = (predicate: Predicate): Predicate => ({ predicate, type: "not" });
export const and = (...predicates: readonly Predicate[]): Predicate => ({
	type: "and",
	predicates: [...predicates],
});
export const or = (...predicates: readonly Predicate[]): Predicate => ({
	type: "or",
	predicates: [...predicates],
});

export const field = (key: string, expr: ScalarExpression): FieldSelection => ({ key, expr });

export const star = (tableName: TableReference): WildcardSelection => ({
	type: "wildcard",
	tableAlias: tableName.alias,
});

export const ascending = (expr: ScalarExpression): OrderBy => ({ expr, direction: "asc" });

export const descending = (expr: ScalarExpression): OrderBy => ({ expr, direction: "desc" });

export const join = (type: Join["type"], tableName: TableReference, on: Predicate): Join => ({
	on,
	type,
	table: tableName,
});

const correlatedQuery = (
	from: TableReference,
	input: CorrelatedQueryInput,
): CorrelatedQuerySet => ({
	from,
	...(input.where ? { where: input.where } : {}),
	...(isNonEmpty(input.joins) ? { joins: [...input.joins] } : {}),
});

export const exists = (
	from: TableReference,
	input: CorrelatedQueryInput = {},
): ExistsExpression => ({ type: "exists", query: correlatedQuery(from, input) });

export const first = (
	from: TableReference,
	input: CorrelatedQueryInput & {
		readonly select: ScalarExpression;
		readonly orderBy: readonly [OrderBy, ...OrderBy[]];
	},
): FirstExpression => ({
	type: "first",
	select: input.select,
	query: correlatedQuery(from, input),
	orderBy: [...input.orderBy] as [OrderBy, ...OrderBy[]],
});

const correlatedAggregate = (
	from: TableReference,
	aggregation: AggregationSpec,
	input: CorrelatedQueryInput,
): AggregateExpression => ({ aggregation, type: "aggregate", query: correlatedQuery(from, input) });

export const count = (from: TableReference, input: CorrelatedQueryInput = {}) =>
	correlatedAggregate(from, { function: "count" }, input);
export const countDistinct = (
	from: TableReference,
	expr: ScalarExpression,
	input: CorrelatedQueryInput = {},
) => correlatedAggregate(from, { expr, function: "countDistinct" }, input);
export const sum = (
	from: TableReference,
	expr: ScalarExpression,
	input: CorrelatedQueryInput = {},
) => correlatedAggregate(from, { expr, function: "sum" }, input);
export const average = (
	from: TableReference,
	expr: ScalarExpression,
	input: CorrelatedQueryInput = {},
) => correlatedAggregate(from, { expr, function: "average" }, input);
export const minimum = (
	from: TableReference,
	expr: ScalarExpression,
	input: CorrelatedQueryInput = {},
) => correlatedAggregate(from, { expr, function: "minimum" }, input);
export const maximum = (
	from: TableReference,
	expr: ScalarExpression,
	input: CorrelatedQueryInput = {},
) => correlatedAggregate(from, { expr, function: "maximum" }, input);

export const measure = (key: string, aggregation: AggregationSpec): AggregateMeasure => ({
	key,
	aggregation,
});

export const groupAscending = (key: string): AggregateOrderBy => ({ key, direction: "asc" });
export const groupDescending = (key: string): AggregateOrderBy => ({ key, direction: "desc" });
export const measureAscending = (key: string): AggregateOrderBy => ({ key, direction: "asc" });
export const measureDescending = (key: string): AggregateOrderBy => ({ key, direction: "desc" });

export const include = (
	from: TableReference,
	input: {
		readonly key: string;
		readonly limit: number;
		readonly where?: Predicate | undefined;
		readonly fields: readonly RowSelection[];
		readonly joins?: readonly Join[] | undefined;
		readonly include?: readonly Include[] | undefined;
		readonly orderBy: readonly [OrderBy, ...OrderBy[]];
	},
): Include => ({
	from,
	key: input.key,
	limit: input.limit,
	fields: [...input.fields],
	...(input.where ? { where: input.where } : {}),
	orderBy: [...input.orderBy] as [OrderBy, ...OrderBy[]],
	...(isNonEmpty(input.joins) ? { joins: [...input.joins] } : {}),
	...(isNonEmpty(input.include) ? { include: [...input.include] } : {}),
});

export const rows = (
	from: TableReference,
	input: {
		readonly after?: string | undefined;
		readonly limit?: number | undefined;
		readonly where?: Predicate | undefined;
		readonly fields: readonly RowSelection[];
		readonly joins?: readonly Join[] | undefined;
		readonly include?: readonly Include[] | undefined;
		readonly orderBy?: readonly OrderBy[] | undefined;
	},
): NamedQuery & { readonly output: RowsOutput } => ({
	from,
	...(input.where ? { where: input.where } : {}),
	...(isNonEmpty(input.joins) ? { joins: [...input.joins] } : {}),
	output: {
		type: "rows",
		fields: [...input.fields],
		pagination: { limit: input.limit ?? 20, ...(input.after ? { after: input.after } : {}) },
		...(isNonEmpty(input.include) ? { include: [...input.include] } : {}),
		orderBy: input.orderBy ? [...input.orderBy] : [ascending(column(from, "id"))],
	},
});

export type SelectedField<A, I = unknown> = {
	readonly expr: ScalarExpression;
	readonly codec: Schema.Codec<A, I>;
};

export const selectedField = <A, I>(
	expr: ScalarExpression,
	codec: Schema.Codec<A, I>,
): SelectedField<A, I> => ({ expr, codec });

export type SelectedSelection = Readonly<Record<string, SelectedField<unknown>>>;

type SelectedValue<Field> = Field extends SelectedField<infer A, infer _I> ? A : never;

type SelectedIncludes = Readonly<
	Record<
		string,
		{
			readonly decodeResult: (result: unknown) => Result.Result<unknown, unknown>;
			readonly include: (key: string) => Include;
		}
	>
>;

type SelectedIncludeValue<Selected> =
	Selected extends SelectedIncludeQuery<infer Selection, infer Includes>
		? SelectedIncludeResult<Selection, Includes>
		: never;

export type SelectedRow<
	Selection extends SelectedSelection,
	Includes extends SelectedIncludes = Record<never, never>,
> = {
	readonly [Key in keyof Selection]: SelectedValue<Selection[Key]>;
} & {
	readonly [Key in keyof Includes]: SelectedIncludeValue<Includes[Key]>;
};

export type SelectedRowsPageInfo = RowsResult["pageInfo"];

export type SelectedIncludePageInfo = IncludeResult["pageInfo"];

export type SelectedRowsResult<
	Selection extends SelectedSelection,
	Includes extends SelectedIncludes = Record<never, never>,
> = {
	readonly items: readonly SelectedRow<Selection, Includes>[];
	readonly pageInfo: SelectedRowsPageInfo;
};

export type SelectedIncludeResult<
	Selection extends SelectedSelection,
	Includes extends SelectedIncludes = Record<never, never>,
> = {
	readonly items: readonly SelectedRow<Selection, Includes>[];
	readonly pageInfo: SelectedIncludePageInfo;
};

type SelectedRowsInput<
	Selection extends SelectedSelection,
	Includes extends SelectedIncludes,
> = Omit<Parameters<typeof rows>[1], "fields" | "include"> & {
	readonly include?: Includes | undefined;
	readonly selection: Selection;
};

export type SelectedQuery<Success, Query extends NamedQuery = NamedQuery> = {
	readonly decodeResult: (result: unknown) => Result.Result<Success, unknown>;
	readonly document: Query;
};

export type SelectedRowsQuery<
	Selection extends SelectedSelection,
	Includes extends SelectedIncludes = Record<never, never>,
> = SelectedQuery<
	SelectedRowsResult<Selection, Includes>,
	NamedQuery & { readonly output: RowsOutput }
>;

export type SelectedIncludeQuery<
	Selection extends SelectedSelection,
	Includes extends SelectedIncludes = Record<never, never>,
> = {
	readonly decodeResult: (
		result: unknown,
	) => Result.Result<SelectedIncludeResult<Selection, Includes>, unknown>;
	readonly include: (key: string) => Include;
};

const fail = (message: string) => Result.fail(new Error(message));

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const record = (value: unknown, message: string) =>
	isRecord(value) ? Result.succeed(value) : fail(message);

const decodeValue = <A, I>(value: unknown, codec: Schema.Codec<A, I>, fieldName: string) =>
	Schema.decodeUnknownResult(codec)(value).pipe(
		Result.mapError(
			(error) => new Error(`RyotQL field '${fieldName}' is malformed`, { cause: error }),
		),
	);

const fromEntries = <const T extends Readonly<Record<string, unknown>>>(
	entries: readonly (readonly [keyof T, unknown])[],
): T =>
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	Object.fromEntries(entries) as T;

type SelectedCodec = { readonly codec: Schema.Codec<unknown, unknown> };

const decodeSelectedEntries = (
	row: Readonly<Record<string, unknown>>,
	selection: Readonly<Record<string, SelectedCodec>>,
	missingField: (key: string) => string,
) =>
	Result.all(
		Object.entries(selection).map(([key, selected]) => {
			const rawValue = row[key];
			return rawValue === undefined
				? fail(missingField(key))
				: Result.map(
						decodeValue(rawValue, selected.codec, key),
						(decoded) => [key, decoded] as const,
					);
		}),
	);

const decodeIncludePageInfo = (value: unknown, path: string) =>
	Result.flatMap(record(value, `RyotQL ${path} pageInfo is malformed`), (pageInfo) =>
		Result.all({
			limit: decodeValue(pageInfo["limit"], Schema.Int, `${path}.pageInfo.limit`),
			hasMore: decodeValue(pageInfo["hasMore"], Schema.Boolean, `${path}.pageInfo.hasMore`),
		}),
	);

const decodeRowsPageInfo = (value: unknown) =>
	Result.flatMap(record(value, "RyotQL rows pageInfo is malformed"), (pageInfo) =>
		Result.all({
			limit: decodeValue(pageInfo["limit"], Schema.Int, "pageInfo.limit"),
			hasMore: decodeValue(pageInfo["hasMore"], Schema.Boolean, "pageInfo.hasMore"),
			nextCursor: decodeValue(
				pageInfo["nextCursor"],
				Schema.NullOr(Schema.String),
				"pageInfo.nextCursor",
			),
		}),
	);

const compileIncludes = (includes: SelectedIncludes | undefined) =>
	includes
		? Object.entries(includes).map(([key, selectedInclude]) => selectedInclude.include(key))
		: [];

const decodeSelectedRow = <Selection extends SelectedSelection, Includes extends SelectedIncludes>(
	value: unknown,
	selection: Selection,
	includes: Includes | undefined,
) => {
	return Result.flatMap(record(value, "RyotQL row is malformed"), (row) => {
		const decodedIncludes = Object.entries(includes ?? {}).map(([key, selectedInclude]) => {
			const rawValue = row[key];
			if (rawValue === undefined) {
				return fail(`RyotQL row is missing selected include '${key}'`);
			}
			return Result.map(
				selectedInclude.decodeResult(rawValue),
				(decoded) => [key, decoded] as const,
			);
		});

		return Result.flatMap(
			decodeSelectedEntries(
				row,
				selection,
				(key) => `RyotQL row is missing selected field '${key}'`,
			),
			(values) =>
				Result.map(Result.all(decodedIncludes), (decoded) =>
					fromEntries<SelectedRow<Selection, Includes>>([...values, ...decoded]),
				),
		);
	});
};

const decodeSelectedRows = <Selection extends SelectedSelection, Includes extends SelectedIncludes>(
	result: unknown,
	selection: Selection,
	includes: Includes | undefined,
) =>
	Result.flatMap(record(result, "RyotQL rows result is malformed"), (rowsResult) => {
		if (rowsResult["type"] !== "rows") {
			return fail("RyotQL result is not rows");
		}
		if (!Array.isArray(rowsResult["items"])) {
			return fail("RyotQL rows items are malformed");
		}
		const rawItems = rowsResult["items"];
		return Result.flatMap(decodeRowsPageInfo(rowsResult["pageInfo"]), (pageInfo) =>
			Result.map(
				Result.all(rawItems.map((row) => decodeSelectedRow(row, selection, includes))),
				(decodedItems) => ({ pageInfo, items: decodedItems }),
			),
		);
	});

export const selectedRows = <
	const Selection extends SelectedSelection,
	const Includes extends SelectedIncludes = Record<never, never>,
>(
	from: TableReference,
	input: SelectedRowsInput<Selection, Includes>,
): SelectedRowsQuery<Selection, Includes> => {
	const { selection, include: includes, ...rowInput } = input;
	return {
		decodeResult: (result) => decodeSelectedRows(result, selection, includes),
		document: rows(from, {
			...rowInput,
			include: compileIncludes(includes),
			fields: Object.entries(selection).map(([key, selected]) => field(key, selected.expr)),
		}),
	};
};

type SelectedCardinalityInput<
	Selection extends SelectedSelection,
	Includes extends SelectedIncludes,
> = Omit<SelectedRowsInput<Selection, Includes>, "limit">;

function selectedRowWithCardinality<
	const Selection extends SelectedSelection,
	const Includes extends SelectedIncludes,
>(
	from: TableReference,
	input: SelectedCardinalityInput<Selection, Includes>,
	optional: false,
): SelectedQuery<SelectedRow<Selection, Includes>>;
function selectedRowWithCardinality<
	const Selection extends SelectedSelection,
	const Includes extends SelectedIncludes,
>(
	from: TableReference,
	input: SelectedCardinalityInput<Selection, Includes>,
	optional: true,
): SelectedQuery<SelectedRow<Selection, Includes> | undefined>;
function selectedRowWithCardinality<
	const Selection extends SelectedSelection,
	const Includes extends SelectedIncludes,
>(
	from: TableReference,
	input: SelectedCardinalityInput<Selection, Includes>,
	optional: boolean,
): SelectedQuery<SelectedRow<Selection, Includes> | undefined> {
	const query = selectedRows(from, { ...input, limit: 2 });
	return {
		document: query.document,
		decodeResult: (result: unknown) =>
			Result.flatMap(query.decodeResult(result), ({ items }) => {
				if (items.length > 1) {
					return fail("RyotQL row query returned more than one row");
				}
				if (items.length === 0 && !optional) {
					return fail("RyotQL row query returned no rows");
				}
				return Result.succeed(items[0]);
			}),
	};
}

export const selectedRow = <
	const Selection extends SelectedSelection,
	const Includes extends SelectedIncludes = Record<never, never>,
>(
	from: TableReference,
	input: SelectedCardinalityInput<Selection, Includes>,
): SelectedQuery<SelectedRow<Selection, Includes>> =>
	selectedRowWithCardinality(from, input, false);

export const selectedOptionalRow = <
	const Selection extends SelectedSelection,
	const Includes extends SelectedIncludes = Record<never, never>,
>(
	from: TableReference,
	input: SelectedCardinalityInput<Selection, Includes>,
): SelectedQuery<SelectedRow<Selection, Includes> | undefined> =>
	selectedRowWithCardinality(from, input, true);

type SelectedIncludeInput<
	Selection extends SelectedSelection,
	Includes extends SelectedIncludes,
> = Omit<Parameters<typeof include>[1], "fields" | "include" | "key"> & {
	readonly include?: Includes | undefined;
	readonly selection: Selection;
};

export const selectedInclude = <
	const Selection extends SelectedSelection,
	const Includes extends SelectedIncludes = Record<never, never>,
>(
	from: TableReference,
	input: SelectedIncludeInput<Selection, Includes>,
): SelectedIncludeQuery<Selection, Includes> => {
	const { selection, include: includes, ...includeInput } = input;
	return {
		include: (key) =>
			include(from, {
				...includeInput,
				key,
				include: compileIncludes(includes),
				fields: Object.entries(selection).map(([fieldKey, selected]) =>
					field(fieldKey, selected.expr),
				),
			}),
		decodeResult: (result) =>
			Result.flatMap(record(result, "RyotQL include result is malformed"), (includeResult) => {
				if (!Array.isArray(includeResult["items"])) {
					return fail("RyotQL include items are malformed");
				}
				const rawItems = includeResult["items"];
				return Result.flatMap(
					decodeIncludePageInfo(includeResult["pageInfo"], "include"),
					(pageInfo) =>
						Result.map(
							Result.all(rawItems.map((row) => decodeSelectedRow(row, selection, includes))),
							(decodedItems) => ({ pageInfo, items: decodedItems }),
						),
				);
			}),
	};
};

type AnySelectedQuery = SelectedQuery<unknown>;

type RecipeQueries = Readonly<Record<string, AnySelectedQuery>>;

type QueryResults<Queries extends RecipeQueries> = {
	readonly [Key in keyof Queries]: Queries[Key] extends SelectedQuery<infer Success>
		? Success
		: never;
};

export type PreparedRecipe<Success> = {
	readonly decode: (response: unknown) => Result.Result<Success, unknown>;
	readonly document: RyotQLDocument;
};

export namespace Recipe {
	export type Success<Factory> = Factory extends (
		...input: infer _Input
	) => PreparedRecipe<infer Decoded>
		? Decoded
		: never;
}

type RecipeDefinition<Queries extends RecipeQueries, Success> = {
	readonly map?: (queries: QueryResults<Queries>) => Result.Result<Success, unknown>;
	readonly queries: Queries;
};

export const defineRecipe =
	<
		const InputTuple extends readonly unknown[],
		const Queries extends RecipeQueries,
		Success = QueryResults<Queries>,
	>(
		builder: (...input: InputTuple) => RecipeDefinition<Queries, Success>,
	) =>
	(...input: InputTuple): PreparedRecipe<Success> => {
		const { map, queries } = builder(...input);
		return {
			document: document(
				Object.fromEntries(
					Object.entries(queries).map(([name, query]) => [name, query.document]),
				) as Record<string, NamedQuery>,
			),
			decode: (response: unknown) => {
				return Result.flatMap(record(response, "RyotQL response is malformed"), (decodedResponse) =>
					Result.flatMap(
						record(decodedResponse["data"], "RyotQL response data is malformed"),
						(data) => {
							const decodedQueries = Object.entries(queries).map(([name, query]) => {
								const result = data[name];
								if (result === undefined) {
									return Result.fail(new Error(`RyotQL response is missing named query '${name}'`));
								}
								return Result.map(
									query.decodeResult(result),
									(decoded) => [name, decoded] as const,
								);
							});
							return Result.flatMap(Result.all(decodedQueries), (entries) => {
								const decoded = fromEntries<QueryResults<Queries>>(entries);
								// oxlint-disable-next-line typescript/no-unsafe-type-assertion
								return map ? map(decoded) : Result.succeed(decoded as Success);
							});
						},
					),
				);
			},
		};
	};

export const aggregate = (
	from: TableReference,
	input: {
		readonly limit?: number | undefined;
		readonly where?: Predicate | undefined;
		readonly joins?: readonly Join[] | undefined;
		readonly groupBy?: readonly FieldSelection[] | undefined;
		readonly measures: readonly [AggregateMeasure, ...AggregateMeasure[]];
		readonly orderBy?: readonly [AggregateOrderBy, ...AggregateOrderBy[]] | undefined;
	},
): NamedQuery & { readonly output: AggregateOutput } => ({
	from,
	...(input.where ? { where: input.where } : {}),
	...(isNonEmpty(input.joins) ? { joins: [...input.joins] } : {}),
	output: {
		type: "aggregate",
		measures: [...input.measures] as [AggregateMeasure, ...AggregateMeasure[]],
		...(input.limit !== undefined ? { limit: input.limit } : {}),
		...(input.groupBy && input.groupBy.length > 0 ? { groupBy: [...input.groupBy] } : {}),
		...(input.orderBy && input.orderBy.length > 0
			? { orderBy: [...input.orderBy] as [AggregateOrderBy, ...AggregateOrderBy[]] }
			: {}),
	},
});

export const timeSeries = (
	from: TableReference,
	input: {
		readonly endAt: string;
		readonly startAt: string;
		readonly time: ScalarExpression;
		readonly where?: Predicate | undefined;
		readonly joins?: readonly Join[] | undefined;
		readonly bucket: TimeSeriesOutput["time"]["bucket"];
		readonly measure: TimeSeriesOutput["measure"]["aggregation"];
	},
): NamedQuery & { readonly output: TimeSeriesOutput } => ({
	from,
	...(input.where ? { where: input.where } : {}),
	...(isNonEmpty(input.joins) ? { joins: [...input.joins] } : {}),
	output: {
		type: "timeSeries",
		measure: { aggregation: input.measure },
		time: {
			expr: input.time,
			bucket: input.bucket,
			range: { endAt: input.endAt, startAt: input.startAt },
		},
	},
});

export type SelectedMeasure<A, I = unknown> = {
	readonly aggregation: AggregationSpec;
	readonly codec: Schema.Codec<A, I>;
};

export const selectedMeasure = <A, I>(
	aggregation: AggregationSpec,
	codec: Schema.Codec<A, I>,
): SelectedMeasure<A, I> => ({ codec, aggregation });

type SelectedMeasures = Readonly<Record<string, SelectedMeasure<unknown>>>;

type SelectedMeasureValue<Measure> = Measure extends SelectedMeasure<infer A, infer _I> ? A : never;

export type SelectedAggregateRow<
	GroupBy extends SelectedSelection,
	Measures extends SelectedMeasures,
> = {
	readonly [Key in keyof GroupBy]: SelectedValue<GroupBy[Key]>;
} & {
	readonly [Key in keyof Measures]: SelectedMeasureValue<Measures[Key]>;
};

export type SelectedAggregateResult<
	GroupBy extends SelectedSelection,
	Measures extends SelectedMeasures,
> = {
	readonly items: readonly SelectedAggregateRow<GroupBy, Measures>[];
	readonly pageInfo?: SelectedIncludePageInfo | undefined;
};

type SelectedAggregateInput<
	GroupBy extends SelectedSelection,
	Measures extends SelectedMeasures,
> = Omit<Parameters<typeof aggregate>[1], "groupBy" | "measures"> & {
	readonly groupBy: GroupBy;
	readonly measures: Measures;
};

type SelectedUngroupedAggregateInput<Measures extends SelectedMeasures> = Omit<
	SelectedAggregateInput<Record<never, never>, Measures>,
	"groupBy"
> & { readonly groupBy?: undefined };

const decodeSelectedAggregateRow = <
	GroupBy extends SelectedSelection,
	Measures extends SelectedMeasures,
>(
	value: unknown,
	groupBy: GroupBy,
	measures: Measures,
) =>
	Result.flatMap(record(value, "RyotQL aggregate row is malformed"), (row) => {
		return Result.map(
			decodeSelectedEntries(
				row,
				{ ...groupBy, ...measures },
				(key) => `RyotQL aggregate row is missing field '${key}'`,
			),
			(entries) => fromEntries<SelectedAggregateRow<GroupBy, Measures>>(entries),
		);
	});

export function selectedAggregate<const Measures extends SelectedMeasures>(
	from: TableReference,
	input: SelectedUngroupedAggregateInput<Measures>,
): SelectedQuery<SelectedAggregateRow<Record<never, never>, Measures>>;
export function selectedAggregate<
	const GroupBy extends SelectedSelection,
	const Measures extends SelectedMeasures,
>(
	from: TableReference,
	input: SelectedAggregateInput<GroupBy, Measures>,
): SelectedQuery<SelectedAggregateResult<GroupBy, Measures>>;
export function selectedAggregate(
	from: TableReference,
	input:
		| SelectedAggregateInput<SelectedSelection, SelectedMeasures>
		| SelectedUngroupedAggregateInput<SelectedMeasures>,
): SelectedQuery<unknown> {
	const { measures, groupBy = {}, ...aggregateInput } = input;
	const compiledMeasures = Object.entries(measures).map(([key, selected]) =>
		measure(key, selected.aggregation),
	);
	const [firstMeasure, ...restMeasures] = compiledMeasures;
	if (firstMeasure === undefined) {
		throw new TypeError("RyotQL selected aggregate requires at least one measure");
	}
	const grouped = input.groupBy !== undefined;
	if (grouped && Object.keys(groupBy).length === 0) {
		throw new TypeError("RyotQL selected aggregate group selection cannot be empty");
	}
	return {
		document: aggregate(from, {
			...aggregateInput,
			measures: [firstMeasure, ...restMeasures],
			groupBy: Object.entries(groupBy).map(([key, selected]) => field(key, selected.expr)),
		}),
		decodeResult: (result) =>
			Result.flatMap(record(result, "RyotQL aggregate result is malformed"), (aggregateResult) => {
				if (aggregateResult["type"] !== "aggregate") {
					return fail("RyotQL result is not aggregate");
				}
				if (!Array.isArray(aggregateResult["items"])) {
					return fail("RyotQL aggregate items are malformed");
				}
				const decodedItems = Result.all(
					aggregateResult["items"].map((row) => decodeSelectedAggregateRow(row, groupBy, measures)),
				);
				if (!grouped) {
					return Result.flatMap(decodedItems, (items) => {
						if (items.length !== 1) {
							return fail("RyotQL ungrouped aggregate did not return exactly one row");
						}
						return Result.succeed(items[0]);
					});
				}
				if (aggregateResult["pageInfo"] === undefined) {
					return Result.map(decodedItems, (items) => ({ items }));
				}
				return Result.flatMap(
					decodeIncludePageInfo(aggregateResult["pageInfo"], "aggregate"),
					(pageInfo) => Result.map(decodedItems, (items) => ({ items, pageInfo })),
				);
			}),
	};
}

type SelectedTimeSeriesSelection = {
	readonly endAt: Schema.Codec<unknown, unknown>;
	readonly startAt: Schema.Codec<unknown, unknown>;
	readonly value: Schema.Codec<unknown, unknown>;
};

type CodecValue<Codec> = Codec extends Schema.Codec<infer A, infer _I> ? A : never;

export type SelectedTimeSeriesBucket<Selection extends SelectedTimeSeriesSelection> = {
	readonly endAt: CodecValue<Selection["endAt"]>;
	readonly startAt: CodecValue<Selection["startAt"]>;
	readonly value: CodecValue<Selection["value"]>;
};

export type SelectedTimeSeriesResult<Selection extends SelectedTimeSeriesSelection> = {
	readonly buckets: readonly SelectedTimeSeriesBucket<Selection>[];
};

type SelectedTimeSeriesInput<Selection extends SelectedTimeSeriesSelection> = Omit<
	Parameters<typeof timeSeries>[1],
	"selection"
> & { readonly selection: Selection };

export const selectedTimeSeries = <const Selection extends SelectedTimeSeriesSelection>(
	from: TableReference,
	input: SelectedTimeSeriesInput<Selection>,
): SelectedQuery<SelectedTimeSeriesResult<Selection>> => {
	const { selection, ...timeSeriesInput } = input;
	return {
		document: timeSeries(from, timeSeriesInput),
		decodeResult: (result) =>
			Result.flatMap(record(result, "RyotQL time-series result is malformed"), (seriesResult) => {
				if (seriesResult["type"] !== "timeSeries") {
					return fail("RyotQL result is not timeSeries");
				}
				if (!Array.isArray(seriesResult["buckets"])) {
					return fail("RyotQL time-series buckets are malformed");
				}
				return Result.map(
					Result.all(
						seriesResult["buckets"].map((value) =>
							Result.flatMap(record(value, "RyotQL time-series bucket is malformed"), (bucket) =>
								Result.all({
									endAt: decodeValue(bucket["endAt"], selection.endAt, "bucket.endAt"),
									value: decodeValue(bucket["value"], selection.value, "bucket.value"),
									startAt: decodeValue(bucket["startAt"], selection.startAt, "bucket.startAt"),
								}),
							),
						),
					),
					(buckets) => {
						// oxlint-disable-next-line typescript/no-unsafe-type-assertion
						const typedBuckets = buckets as readonly SelectedTimeSeriesBucket<Selection>[];
						return { buckets: typedBuckets };
					},
				);
			}),
	};
};

export const document = <const Queries extends Readonly<Record<string, NamedQuery>>>(
	queries: Queries,
) => ({ queries: { ...queries } }) satisfies RyotQLDocument;
