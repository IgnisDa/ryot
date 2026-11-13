import { isObjectRecord, isUnknownArray } from "@ryot-app/ts-utils/predicates";
import { Result, Schema } from "effect";

import { strictStruct } from "../../schema/utils";
import { ValueFilterField } from "../filters/schemas";
import { BrowseSort } from "../filters/sort";
import { PluginIdentityReference, QueryOwnerReference } from "../plugins/references";
import type { CastTarget, JsonPath, TransformName } from "./grammar";
import { DateBucketUnit, scalarOperations } from "./grammar";
import {
	AggregateOrderBy,
	ColumnExpression,
	CurrentDateExpression,
	JsonElementExpression,
	LiteralExpression,
	OutputFieldKey,
	PluginIdExpression,
	WildcardSelection,
} from "./language";
import * as Bound from "./language";
import { ParameterSchema } from "./parameters";

export const ParameterExpression = strictStruct({
	name: Schema.NonEmptyString,
	type: Schema.Literal("parameter"),
});
export type ParameterExpression = typeof ParameterExpression.Type;
const ReportingTimeZone = strictStruct({
	type: Schema.Literal("context"),
	name: Schema.Literal("reportingTimeZone"),
});
type ReportingTimeZone = typeof ReportingTimeZone.Type;
const TimeZoneInput = Schema.Union([Schema.String, ParameterExpression, ReportingTimeZone]);
export type Ordering =
	| { readonly type: "sort"; readonly otherwise: readonly OrderBy[] }
	| {
			readonly type: "choice";
			readonly parameter: string;
			readonly cases: Readonly<Record<string, Ordering | readonly OrderBy[]>>;
	  };
export const Ordering: Schema.Codec<Ordering, unknown> = Schema.suspend(() =>
	Schema.Union([
		strictStruct({ type: Schema.Literal("sort"), otherwise: Schema.Array(OrderBy) }),
		strictStruct({
			parameter: Schema.String,
			type: Schema.Literal("choice"),
			cases: Schema.Record(Schema.String, Schema.Union([Schema.Array(OrderBy), Ordering])),
		}),
	]),
);
export type AggregateOrdering =
	| { readonly type: "sort"; readonly otherwise: readonly Bound.AggregateOrderBy[] }
	| {
			readonly type: "choice";
			readonly parameter: string;
			readonly cases: Readonly<
				Record<string, AggregateOrdering | readonly Bound.AggregateOrderBy[]>
			>;
	  };
export const AggregateOrdering: Schema.Codec<AggregateOrdering, unknown> = Schema.suspend(() =>
	Schema.Union([
		strictStruct({ type: Schema.Literal("sort"), otherwise: Schema.Array(Bound.AggregateOrderBy) }),
		strictStruct({
			parameter: Schema.String,
			type: Schema.Literal("choice"),
			cases: Schema.Record(
				Schema.String,
				Schema.Union([Schema.Array(Bound.AggregateOrderBy), AggregateOrdering]),
			),
		}),
	]),
);
export const OutputControlField = Schema.Union([
	strictStruct({ ...ValueFilterField.members[0].fields, sort: Schema.optionalKey(BrowseSort) }),
	strictStruct({ ...ValueFilterField.members[1].fields, sort: Schema.optionalKey(BrowseSort) }),
]);
export type OutputControlField = typeof OutputControlField.Type;

const AtomicControlTarget = Schema.Union([
	strictStruct({
		alias: Schema.String,
		kind: Schema.Literal("browse"),
		schemas: Schema.NonEmptyArray(
			strictStruct({ owner: QueryOwnerReference, slug: Schema.NonEmptyString }),
		),
	}),
	strictStruct({
		kind: Schema.Literal("outputs"),
		fields: Schema.Array(OutputControlField),
		query: Schema.optional(Schema.NonEmptyString),
	}),
]);
export const ControlTarget = Schema.Union([
	AtomicControlTarget,
	strictStruct({
		kind: Schema.Literal("composite"),
		targets: Schema.NonEmptyArray(AtomicControlTarget),
	}),
]);
export const controlTargets = (
	target: typeof ControlTarget.Type,
): readonly (typeof AtomicControlTarget.Type)[] =>
	target.kind === "composite" ? target.targets : [target];

export const Controls = strictStruct({
	sort: Schema.optional(ControlTarget),
	filter: Schema.optional(ControlTarget),
});
export type Controls = typeof Controls.Type;

export const TableReference = Schema.Union([
	Bound.TableReference,
	strictStruct({
		alias: Schema.String,
		parameter: Schema.NonEmptyString,
		type: Schema.Literal("sourceEntity"),
	}),
]);
export type TableReference = typeof TableReference.Type;

export type ExistsExpression = { readonly type: "exists"; readonly query: CorrelatedQuerySet };

export type JsonArrayCountExpression = {
	readonly type: "jsonCount";
	readonly array: ScalarExpression;
	readonly where?: Predicate | undefined;
};

export type JsonArrayExistsExpression = {
	readonly type: "jsonExists";
	readonly array: ScalarExpression;
	readonly where?: Predicate | undefined;
};

export type CorrelatedQuerySet = {
	readonly from: TableReference;
	readonly where?: Predicate | undefined;
	readonly joins?: undefined | readonly [Join, ...Join[]];
};

export type JsonArrayFirstExpression = {
	readonly type: "jsonFirst";
	readonly array: ScalarExpression;
	readonly select: ScalarExpression;
	readonly where?: Predicate | undefined;
	readonly orderBy: Ordering | readonly [OrderBy, ...OrderBy[]];
};

export type AggregationSpec =
	| { readonly function: "count" }
	| { readonly expr: ScalarExpression; readonly function: "countDistinct" }
	| {
			readonly expr: ScalarExpression;
			readonly function: "sum" | "average" | "maximum" | "minimum";
	  };

export type ScalarExpression =
	| ColumnExpression
	| ExistsExpression
	| LiteralExpression
	| PluginIdExpression
	| ParameterExpression
	| CurrentDateExpression
	| JsonElementExpression
	| { readonly type: "now" }
	| JsonArrayCountExpression
	| JsonArrayFirstExpression
	| JsonArrayExistsExpression
	| { readonly type: "floor"; readonly expr: ScalarExpression }
	| { readonly type: "round"; readonly expr: ScalarExpression }
	| { readonly type: "integer"; readonly expr: ScalarExpression }
	| { readonly type: "isNotNull"; readonly expr: ScalarExpression }
	| { readonly type: "concat"; readonly values: readonly [ScalarExpression, ...ScalarExpression[]] }
	| {
			readonly type: "coalesce";
			readonly values: readonly [ScalarExpression, ...ScalarExpression[]];
	  }
	| {
			readonly type: "cast";
			readonly expr: ScalarExpression;
			readonly target: typeof CastTarget.Type;
	  }
	| {
			readonly type: "jsonPath";
			readonly expr: ScalarExpression;
			readonly path: typeof JsonPath.Type;
	  }
	| {
			readonly type: "transform";
			readonly expr: ScalarExpression;
			readonly name: typeof TransformName.Type;
	  }
	| {
			readonly type: "aggregate";
			readonly query: CorrelatedQuerySet;
			readonly aggregation: AggregationSpec;
	  }
	| {
			readonly type: "choice";
			readonly parameter: string;
			readonly cases: Readonly<Record<string, ScalarExpression>>;
	  }
	| {
			readonly type: "localDate";
			readonly expr: ScalarExpression;
			readonly timeZone: string | ReportingTimeZone | ParameterExpression;
	  }
	| {
			readonly type: "localHour";
			readonly expr: ScalarExpression;
			readonly timeZone: string | ReportingTimeZone | ParameterExpression;
	  }
	| {
			readonly type: "conditional";
			readonly condition: Predicate;
			readonly whenTrue: ScalarExpression;
			readonly whenFalse: ScalarExpression;
	  }
	| {
			readonly type: "first";
			readonly select: ScalarExpression;
			readonly query: CorrelatedQuerySet;
			readonly orderBy: Ordering | readonly [OrderBy, ...OrderBy[]];
	  }
	| {
			readonly type: "arithmetic";
			readonly left: ScalarExpression;
			readonly right: ScalarExpression;
			readonly operator: "add" | "divide" | "multiply" | "subtract";
	  }
	| {
			readonly type: "dateAdd";
			readonly expr: ScalarExpression;
			readonly amount: number | ParameterExpression;
			readonly unit: "day" | "hour" | "week" | "year" | "month";
	  }
	| {
			readonly type: "dateBucket";
			readonly expr: ScalarExpression;
			readonly bucket: ParameterExpression | typeof DateBucketUnit.Type;
			readonly timeZone: string | ReportingTimeZone | ParameterExpression;
	  };

export const CorrelatedQuerySet: Schema.Codec<CorrelatedQuerySet, unknown> = Schema.suspend(() =>
	strictStruct({
		from: TableReference,
		where: Schema.optional(Predicate),
		joins: Schema.optional(Schema.NonEmptyArray(Join)),
	}),
).annotate({ identifier: "AuthoredRyotQLCorrelatedQuerySet" });

export const AggregationSpec: Schema.Codec<AggregationSpec, unknown> = Schema.suspend(() =>
	Schema.Union([
		strictStruct({ function: Schema.Literal("count") }),
		strictStruct({ expr: ScalarExpression, function: Schema.Literal("countDistinct") }),
		strictStruct({
			expr: ScalarExpression,
			function: Schema.Literals(["average", "maximum", "minimum", "sum"]),
		}),
	]),
).annotate({ identifier: "AuthoredRyotQLAggregationSpec" });

export const ExistsExpression: Schema.Codec<ExistsExpression, unknown> = Schema.suspend(() =>
	strictStruct({ query: CorrelatedQuerySet, type: Schema.Literal("exists") }),
).annotate({ identifier: "AuthoredRyotQLExistsExpression" });

export const ScalarExpression: Schema.Codec<ScalarExpression, unknown> = Schema.suspend(() =>
	Schema.Union([
		ParameterExpression,
		strictStruct({ type: Schema.Literal("now") }),
		strictStruct({
			unit: DateBucketUnit,
			expr: ScalarExpression,
			type: Schema.Literal("dateAdd"),
			amount: Schema.Union([Schema.Finite, ParameterExpression]),
		}),
		strictStruct({
			parameter: Schema.String,
			type: Schema.Literal("choice"),
			cases: Schema.Record(Schema.String, ScalarExpression),
		}),
		ColumnExpression,
		LiteralExpression,
		PluginIdExpression,
		ExistsExpression,
		JsonElementExpression,
		CurrentDateExpression,
		JsonArrayExistsExpression,
		JsonArrayFirstExpression,
		JsonArrayCountExpression,
		scalarOperations({
			predicate: Predicate,
			timeZone: TimeZoneInput,
			query: CorrelatedQuerySet,
			expression: ScalarExpression,
			aggregation: AggregationSpec,
			bucket: Schema.Union([DateBucketUnit, ParameterExpression]),
			ordering: Schema.Union([Schema.NonEmptyArray(OrderBy), Ordering]),
		}),
	]),
).annotate({ identifier: "AuthoredRyotQLScalarExpression" });

const IsNullPredicate = strictStruct({ expr: ScalarExpression, type: Schema.Literal("isNull") });

const IsNotNullPredicate = strictStruct({
	expr: ScalarExpression,
	type: Schema.Literal("isNotNull"),
});

const InPredicate = strictStruct({
	expr: ScalarExpression,
	type: Schema.Literal("in"),
	values: Schema.Union([Schema.Array(ScalarExpression), ParameterExpression]),
});

const ContainsPredicate = strictStruct({
	left: ScalarExpression,
	right: ScalarExpression,
	type: Schema.Literal("contains"),
});

const StartsWithPredicate = strictStruct({
	left: ScalarExpression,
	right: ScalarExpression,
	type: Schema.Literal("startsWith"),
});

const ComparisonOperator = Schema.Literals(["eq", "gt", "gte", "lt", "lte", "neq"]);

const ComparisonPredicate = strictStruct({
	left: ScalarExpression,
	right: ScalarExpression,
	operator: ComparisonOperator,
	type: Schema.Literal("comparison"),
});

export type Predicate =
	| ExistsExpression
	| typeof InPredicate.Type
	| JsonArrayExistsExpression
	| { readonly type: "filter" }
	| typeof IsNullPredicate.Type
	| typeof ContainsPredicate.Type
	| typeof IsNotNullPredicate.Type
	| typeof StartsWithPredicate.Type
	| typeof ComparisonPredicate.Type
	| { readonly type: "not"; readonly predicate: Predicate }
	| { readonly type: "or"; readonly predicates: readonly Predicate[] }
	| { readonly type: "and"; readonly predicates: readonly Predicate[] }
	| { readonly type: "whenSet"; readonly parameter: string; readonly predicate: Predicate }
	| {
			readonly type: "choice";
			readonly parameter: string;
			readonly cases: Readonly<Record<string, Predicate>>;
	  };

export const Predicate: Schema.Codec<Predicate, unknown> = Schema.suspend(() =>
	Schema.Union([
		strictStruct({ type: Schema.Literal("filter") }),
		strictStruct({
			predicate: Predicate,
			parameter: Schema.String,
			type: Schema.Literal("whenSet"),
		}),
		strictStruct({
			parameter: Schema.String,
			type: Schema.Literal("choice"),
			cases: Schema.Record(Schema.String, Predicate),
		}),
		InPredicate,
		IsNullPredicate,
		ExistsExpression,
		JsonArrayExistsExpression,
		ContainsPredicate,
		StartsWithPredicate,
		IsNotNullPredicate,
		ComparisonPredicate,
		strictStruct({ predicate: Predicate, type: Schema.Literal("not") }),
		strictStruct({ type: Schema.Literal("or"), predicates: Schema.Array(Predicate) }),
		strictStruct({ type: Schema.Literal("and"), predicates: Schema.Array(Predicate) }),
	]),
).annotate({ identifier: "AuthoredRyotQLPredicate" });

const TableJoin = strictStruct({
	on: Predicate,
	table: TableReference,
	type: Schema.Literals(["inner", "left"]),
}).annotate({ identifier: "AuthoredRyotQLTableJoin" });

export const JsonElementsJoin = strictStruct({
	alias: Schema.String,
	expr: ScalarExpression,
	type: Schema.Literal("jsonElements"),
	mode: Schema.Literals(["inner", "left"]),
}).annotate({ identifier: "AuthoredRyotQLJsonElementsJoin" });
export type JsonElementsJoin = typeof JsonElementsJoin.Type;

export const Join = Schema.Union([TableJoin, JsonElementsJoin]).annotate({
	identifier: "AuthoredRyotQLJoin",
});
export type Join = typeof Join.Type;

export const FieldSelection = strictStruct({
	key: OutputFieldKey,
	expr: ScalarExpression,
}).annotate({ identifier: "AuthoredRyotQLFieldSelection" });
export type FieldSelection = typeof FieldSelection.Type;

export const RowSelection = Schema.Union([FieldSelection, WildcardSelection]).annotate({
	identifier: "AuthoredRyotQLRowSelection",
});
export type RowSelection = typeof RowSelection.Type;

export const OrderBy = strictStruct({
	expr: ScalarExpression,
	direction: Schema.Literals(["asc", "desc"]),
}).annotate({ identifier: "AuthoredRyotQLOrderBy" });
export type OrderBy = typeof OrderBy.Type;

export const JsonArrayExistsExpression: Schema.Codec<JsonArrayExistsExpression, unknown> =
	Schema.suspend(() =>
		strictStruct({
			array: ScalarExpression,
			where: Schema.optional(Predicate),
			type: Schema.Literal("jsonExists"),
		}),
	).annotate({ identifier: "AuthoredRyotQLJsonArrayExistsExpression" });

export const JsonArrayFirstExpression: Schema.Codec<JsonArrayFirstExpression, unknown> =
	Schema.suspend(() =>
		strictStruct({
			array: ScalarExpression,
			select: ScalarExpression,
			where: Schema.optional(Predicate),
			type: Schema.Literal("jsonFirst"),
			orderBy: Schema.Union([Schema.NonEmptyArray(OrderBy), Ordering]),
		}),
	).annotate({ identifier: "AuthoredRyotQLJsonArrayFirstExpression" });

export const JsonArrayCountExpression: Schema.Codec<JsonArrayCountExpression, unknown> =
	Schema.suspend(() =>
		strictStruct({
			array: ScalarExpression,
			where: Schema.optional(Predicate),
			type: Schema.Literal("jsonCount"),
		}),
	).annotate({ identifier: "AuthoredRyotQLJsonArrayCountExpression" });

export const AggregateMeasure = strictStruct({
	key: Schema.String,
	aggregation: AggregationSpec,
}).annotate({ identifier: "AuthoredRyotQLAggregateMeasure" });
export type AggregateMeasure = typeof AggregateMeasure.Type;

export type Include = {
	readonly key: string;
	readonly limit: number;
	readonly from: TableReference;
	readonly where?: Predicate | undefined;
	readonly fields: readonly RowSelection[];
	readonly joins?: undefined | readonly [Join, ...Join[]];
	readonly orderBy: Ordering | readonly [OrderBy, ...OrderBy[]];
	readonly include?: undefined | readonly [Include, ...Include[]];
};

export const Include: Schema.Codec<Include, unknown> = Schema.suspend(() =>
	strictStruct({
		key: Schema.String,
		from: TableReference,
		where: Schema.optional(Predicate),
		fields: Schema.Array(RowSelection),
		joins: Schema.optional(Schema.NonEmptyArray(Join)),
		include: Schema.optional(Schema.NonEmptyArray(Include)),
		limit: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
		orderBy: Schema.Union([Schema.NonEmptyArray(OrderBy), Ordering]),
	}),
).annotate({ identifier: "AuthoredRyotQLInclude" });

export const Pagination = strictStruct({
	limit: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
	maxLimit: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
}).annotate({ identifier: "AuthoredRyotQLPagination" });
export type Pagination = typeof Pagination.Type;

export const RowsOutput = strictStruct({
	pagination: Pagination,
	type: Schema.Literal("rows"),
	fields: Schema.Array(RowSelection),
	include: Schema.optional(Schema.NonEmptyArray(Include)),
	orderBy: Schema.Union([Schema.Array(OrderBy), Ordering]),
	presentation: Schema.optional(Bound.PresentationSelection),
}).annotate({ identifier: "AuthoredRyotQLRowsOutput" });
export type RowsOutput = typeof RowsOutput.Type;

export const AggregateOutput = strictStruct({
	type: Schema.Literal("aggregate"),
	measures: Schema.NonEmptyArray(AggregateMeasure),
	groupBy: Schema.optional(Schema.Array(FieldSelection)),
	limit: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))),
	maxLimit: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))),
	orderBy: Schema.optional(
		Schema.Union([Schema.NonEmptyArray(AggregateOrderBy), AggregateOrdering]),
	),
}).annotate({ identifier: "AuthoredRyotQLAggregateOutput" });
export type AggregateOutput = typeof AggregateOutput.Type;

export const NamedQuery = strictStruct({
	from: TableReference,
	where: Schema.optional(Predicate),
	joins: Schema.optional(Schema.NonEmptyArray(Join)),
	output: Schema.Union([RowsOutput, AggregateOutput]),
}).annotate({ identifier: "AuthoredRyotQLNamedQuery" });
export type NamedQuery = typeof NamedQuery.Type;

export const RyotQLDocument = strictStruct({
	controls: Schema.optional(Controls),
	parameters: Schema.optional(ParameterSchema),
	queries: Schema.Record(Schema.String, NamedQuery),
}).annotate({ identifier: "AuthoredRyotQLDocument" });
export type RyotQLDocument = typeof RyotQLDocument.Type;

type AuthoredMapping = {
	readonly sourceEntity?: () => void;
	readonly alias?: (alias: string) => string;
	readonly table?: (table: string) => string;
	readonly reference?: (reference: PluginIdentityReference) => PluginIdentityReference;
};

const mapAuthoredNode = (value: unknown, transform: AuthoredMapping): unknown => {
	if (isUnknownArray(value)) {
		return value.map((child) => mapAuthoredNode(child, transform));
	}
	if (!isObjectRecord(value) || value["type"] === "literal") {
		return value;
	}
	const reference = Schema.decodeUnknownResult(PluginIdentityReference)(value);
	if (Result.isSuccess(reference)) {
		return transform.reference?.(reference.success) ?? reference.success;
	}
	if (value["type"] === "sourceEntity") {
		transform.sourceEntity?.();
	}
	return Object.fromEntries(
		Object.entries(value).map(([key, child]) => {
			if (typeof child === "string") {
				if (transform.alias !== undefined && (key === "alias" || key === "tableAlias")) {
					return [key, transform.alias(child)];
				}
				if (
					transform.table !== undefined &&
					key === "table" &&
					typeof value["alias"] === "string"
				) {
					return [key, transform.table(child)];
				}
			}
			return [key, mapAuthoredNode(child, transform)];
		}),
	);
};

export const mapPluginIdentityReferences = (
	document: RyotQLDocument,
	transform: (reference: PluginIdentityReference) => PluginIdentityReference,
) =>
	Schema.decodeUnknownResult(RyotQLDocument)(mapAuthoredNode(document, { reference: transform }));

export const pluginIdentityReferences = (document: RyotQLDocument) => {
	const references: PluginIdentityReference[] = [];
	mapAuthoredNode(document, {
		reference: (reference) => {
			references.push(reference);
			return reference;
		},
	});
	return references;
};

export const mapScalarExpression = (
	expression: ScalarExpression,
	transform: AuthoredMapping,
): ScalarExpression =>
	Result.getOrThrow(
		Schema.decodeUnknownResult(ScalarExpression)(mapAuthoredNode(expression, transform)),
	);

const referencedTables = (value: RyotQLDocument | ScalarExpression): ReadonlySet<string> => {
	const tables = new Set<string>();
	mapAuthoredNode(value, {
		sourceEntity: () => {
			tables.add("sourceEntity");
		},
		table: (table) => {
			tables.add(table);
			return table;
		},
	});
	return tables;
};

export const scalarExpressionTables = (expression: ScalarExpression): ReadonlySet<string> =>
	referencedTables(expression);
export const documentTables = (document: RyotQLDocument): ReadonlySet<string> =>
	referencedTables(document);
