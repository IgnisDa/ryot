import {
	type Filter,
	type FilterOperator,
	filterOperators,
	type FilterRule,
	linkFilterOperators,
	type QueryFilterField,
} from "@ryot-app/contract/modules/filters/schemas";
import type {
	CorrelatedQuerySet,
	FieldSelection,
	NamedQuery,
	Predicate,
	RowsOutput,
	ScalarExpression,
} from "@ryot-app/contract/modules/ryotql/authored";
import { DateTime, Result } from "effect";

import {
	and,
	castBoolean,
	castDate,
	castNumber,
	castText,
	column,
	contains,
	eq,
	eventSchemaPredicate,
	exists,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	join,
	jsonArrayExists,
	jsonElement,
	literal,
	lt,
	lte,
	not,
	or,
	relationshipSchemaPredicate,
	table,
} from "./index";

const failure = (message: string) => Result.fail(new Error(message));

export type FilterFieldSpec = WithoutOutputField<QueryFilterField>;

export type RowsQuery = NamedQuery & { readonly output: RowsOutput };

export type QueryRelationshipFilterField = Extract<
	QueryFilterField,
	{ readonly kind: "relationship" }
>;

/** A filter field and how it compiles; rows matching no branch never match its rules. */
export type FilterTarget = {
	readonly spec: FilterFieldSpec;
	readonly branches: readonly [FilterBranch, ...FilterBranch[]];
};

export type FilterBranch = {
	readonly when?: Predicate | undefined;
	readonly value?: undefined | ScalarExpression;
	readonly link?: undefined | LinkFilterFieldSpec;
};

type LinkFilterFieldSpec = Exclude<FilterFieldSpec, { readonly kind: "value" }>;

type ValueFilterFieldSpec = Extract<FilterFieldSpec, { readonly kind: "value" }>;

type WithoutOutputField<Field> = Field extends { readonly kind: "value" }
	? Omit<Field, "field">
	: Field;

const selectedExpression = (source: RowsQuery, key: string) =>
	source.output.fields.find(
		(selection): selection is FieldSelection => "key" in selection && selection.key === key,
	)?.expr;

export const outputFilterTargets = (
	source: RowsQuery,
	fields: readonly QueryFilterField[],
): Result.Result<readonly FilterTarget[], Error> =>
	Result.all(
		fields.map((field): Result.Result<FilterTarget, Error> => {
			if (field.kind !== "value") {
				return Result.succeed({ spec: field, branches: [{}] });
			}
			const value = selectedExpression(source, field.field);
			return value === undefined
				? failure(`Filter field '${field.key}' references missing output field '${field.field}'`)
				: Result.succeed({ spec: field, branches: [{ value }] });
		}),
	);

export const queryAliases = (source: Pick<CorrelatedQuerySet, "from" | "joins">) => [
	source.from.alias,
	...(source.joins ?? []).map((joined) =>
		joined.type === "jsonElements" ? joined.alias : joined.table.alias,
	),
];

export type FilterInput =
	| { readonly filter: Filter; readonly now: DateTime.Utc }
	| { readonly now?: undefined; readonly filter?: undefined };

type CompileContext = Omit<CompileInput, "filter"> & { readonly aliases: Set<string> };

type CompileInput = {
	readonly filter: Filter;
	readonly now: DateTime.Utc;
	readonly targets: readonly FilterTarget[];
	readonly source: Pick<CorrelatedQuerySet, "from" | "joins">;
	readonly subject: undefined | { readonly entityAlias: string };
};

const unavailable = (rule: FilterRule, key: string) =>
	failure(`Operator '${rule.operator}' is not available for field '${key}'`);

const unusedAlias = (aliases: Set<string>, base: string) => {
	let alias = base;
	while (aliases.has(alias)) {
		alias = `_${alias}`;
	}
	aliases.add(alias);
	return alias;
};

const textLiterals = (values: readonly string[]) => values.map((value) => literal(value));

const element = () => castText(jsonElement());

const isoDate = (value: string) => castDate(literal(value));

const compileRelationship = (
	context: CompileContext,
	rule: FilterRule,
	spec: QueryRelationshipFilterField,
): Result.Result<Predicate, Error> => {
	if (!context.subject) {
		return failure(`Relationship filter field '${spec.key}' requires a view subject`);
	}
	const entityId = column(table("entity", context.subject.entityAlias), "id");
	const [ownColumn, otherColumn] =
		spec.direction === "outgoing"
			? (["sourceEntityId", "targetEntityId"] as const)
			: (["targetEntityId", "sourceEntityId"] as const);
	const linked = (...extra: readonly ((alias: ReturnType<typeof table>) => Predicate)[]) => {
		const alias = table("relationship", unusedAlias(context.aliases, "relationship"));
		return exists(alias, {
			where: and(
				relationshipSchemaPredicate(alias, spec.relationship.slug, spec.relationship.owner),
				eq(column(alias, ownColumn), entityId),
				...extra.map((predicate) => predicate(alias)),
			),
		});
	};
	const linkedTo = (ids: readonly string[]) =>
		linked((alias) => inArray(column(alias, otherColumn), textLiterals(ids)));
	switch (rule.operator) {
		case "eq":
		case "is":
		case "gte":
		case "lte":
		case "after":
		case "before":
		case "isTrue":
		case "between":
		case "isFalse":
		case "contains":
		case "notContains":
		case "betweenDates":
		case "withinLastDays":
			break;
		case "anyOf":
			return Result.succeed(linkedTo(rule.values));
		case "allOf":
			return Result.succeed(and(...rule.values.map((value) => linkedTo([value]))));
		case "empty":
			return Result.succeed(not(linked()));
		case "noneOf":
			return Result.succeed(not(linkedTo(rule.values)));
		case "notEmpty":
			return Result.succeed(linked());
	}
	return unavailable(rule, spec.key);
};

type QuerySessionEventFilterField = Extract<QueryFilterField, { readonly kind: "session-event" }>;

const compileSessionEvent = (
	context: CompileContext,
	rule: FilterRule,
	spec: QuerySessionEventFilterField,
): Result.Result<Predicate, Error> => {
	if (!context.subject) {
		return failure(`Session event filter field '${spec.key}' requires a view subject`);
	}
	const sessionId = column(table("entity", context.subject.entityAlias), "id");
	const { slug, owner, entitySchemaSlug } = spec.event;
	const logged = (...extra: readonly ((event: ReturnType<typeof table>) => Predicate)[]) => {
		const event = table("event", unusedAlias(context.aliases, "event"));
		const entity = table("entity", unusedAlias(context.aliases, "eventEntity"));
		return exists(event, {
			joins: [join("inner", entity, eq(column(entity, "id"), column(event, "entityId")))],
			where: and(
				eventSchemaPredicate(event, entity, entitySchemaSlug, slug, owner),
				eq(column(event, "sessionEntityId"), sessionId),
				...extra.map((predicate) => predicate(event)),
			),
		});
	};
	const loggedFor = (ids: readonly string[]) =>
		logged((event) => inArray(column(event, "entityId"), textLiterals(ids)));
	switch (rule.operator) {
		case "eq":
		case "is":
		case "gte":
		case "lte":
		case "after":
		case "before":
		case "isTrue":
		case "between":
		case "isFalse":
		case "contains":
		case "notContains":
		case "betweenDates":
		case "withinLastDays":
			break;
		case "anyOf":
			return Result.succeed(loggedFor(rule.values));
		case "allOf":
			return Result.succeed(and(...rule.values.map((value) => loggedFor([value]))));
		case "empty":
			return Result.succeed(not(logged()));
		case "noneOf":
			return Result.succeed(not(loggedFor(rule.values)));
		case "notEmpty":
			return Result.succeed(logged());
	}
	return unavailable(rule, spec.key);
};

const compileList = (
	expr: ScalarExpression,
	rule: FilterRule,
	spec: ValueFilterFieldSpec,
): Result.Result<Predicate, Error> => {
	switch (rule.operator) {
		case "is":
		case "eq":
		case "gte":
		case "lte":
		case "after":
		case "before":
		case "isTrue":
		case "between":
		case "isFalse":
		case "notContains":
		case "betweenDates":
		case "withinLastDays":
			break;
		case "anyOf":
			return Result.succeed(jsonArrayExists(expr, inArray(element(), textLiterals(rule.values))));
		case "allOf":
			return Result.succeed(
				and(...rule.values.map((value) => jsonArrayExists(expr, eq(element(), literal(value))))),
			);
		case "empty":
			return Result.succeed(or(isNull(expr), not(jsonArrayExists(expr))));
		case "noneOf":
			return Result.succeed(
				not(jsonArrayExists(expr, inArray(element(), textLiterals(rule.values)))),
			);
		case "contains":
			return Result.succeed(jsonArrayExists(expr, contains(element(), literal(rule.value))));
		case "notEmpty":
			return Result.succeed(jsonArrayExists(expr));
	}
	return unavailable(rule, spec.key);
};

const compileScalar = (
	now: DateTime.Utc,
	expr: ScalarExpression,
	rule: FilterRule,
	spec: ValueFilterFieldSpec,
): Result.Result<Predicate, Error> => {
	const text = castText(expr);
	const number = castNumber(expr);
	const date = castDate(expr);
	switch (rule.operator) {
		case "is":
			return Result.succeed(eq(text, literal(rule.value)));
		case "eq":
			return Result.succeed(eq(number, literal(rule.value)));
		case "gte":
			return Result.succeed(gte(number, literal(rule.value)));
		case "lte":
			return Result.succeed(lte(number, literal(rule.value)));
		case "empty":
			return Result.succeed(isNull(expr));
		case "anyOf":
			return Result.succeed(inArray(text, textLiterals(rule.values)));
		case "after":
			return Result.succeed(gt(date, isoDate(rule.value)));
		case "allOf":
			break;
		case "noneOf":
			return Result.succeed(or(isNull(expr), not(inArray(text, textLiterals(rule.values)))));
		case "before":
			return Result.succeed(lt(date, isoDate(rule.value)));
		case "isTrue":
			return Result.succeed(eq(castBoolean(expr), literal(true)));
		case "between":
			return rule.min > rule.max
				? failure(`Range for field '${spec.key}' must not be inverted`)
				: Result.succeed(and(gte(number, literal(rule.min)), lte(number, literal(rule.max))));
		case "isFalse":
			return Result.succeed(eq(castBoolean(expr), literal(false)));
		case "notEmpty":
			return Result.succeed(isNotNull(expr));
		case "contains":
			return Result.succeed(contains(text, literal(rule.value)));
		case "notContains":
			return Result.succeed(or(isNull(expr), not(contains(text, literal(rule.value)))));
		case "betweenDates":
			return Result.succeed(and(gte(date, isoDate(rule.from)), lte(date, isoDate(rule.to))));
		case "withinLastDays":
			return Result.succeed(
				gte(date, isoDate(DateTime.formatIso(DateTime.subtract(now, { days: rule.days })))),
			);
	}
	return unavailable(rule, spec.key);
};

const compileBranch = (
	context: CompileContext,
	rule: FilterRule,
	spec: FilterFieldSpec,
	branch: FilterBranch,
): Result.Result<Predicate, Error> => {
	const link = spec.kind === "value" ? undefined : (branch.link ?? spec);
	if (link?.kind === "relationship") {
		return compileRelationship(context, rule, link);
	}
	if (link?.kind === "session-event") {
		return compileSessionEvent(context, rule, link);
	}
	if (spec.kind !== "value" || branch.value === undefined) {
		return failure(`Filter field '${spec.key}' has no value expression`);
	}
	return spec.type === "enum-list" || spec.type === "text-list"
		? compileList(branch.value, rule, spec)
		: compileScalar(context.now, branch.value, rule, spec);
};

const compileRule = (
	context: CompileContext,
	rule: FilterRule,
): Result.Result<Predicate, Error> => {
	const target = context.targets.find(({ spec }) => spec.key === rule.field);
	if (!target) {
		return failure(`Unknown filter field '${rule.field}'`);
	}
	if (!filterOperatorsFor(target.spec).includes(rule.operator)) {
		return unavailable(rule, target.spec.key);
	}
	return Result.map(
		Result.all(
			target.branches.map((branch) =>
				Result.map(compileBranch(context, rule, target.spec, branch), (predicate) =>
					branch.when === undefined ? predicate : and(branch.when, predicate),
				),
			),
		),
		(predicates) => (predicates.length === 1 && predicates[0] ? predicates[0] : or(...predicates)),
	);
};

const compileNode = (
	context: CompileContext,
	filter: Filter,
): Result.Result<Predicate | undefined, Error> => {
	if ("field" in filter) {
		return compileRule(context, filter);
	}
	if (filter.type === "not") {
		return Result.map(compileNode(context, filter.filter), (inner) => inner && not(inner));
	}
	return Result.map(
		Result.all(filter.filters.map((child) => compileNode(context, child))),
		(children) => {
			const predicates = children.filter((child) => child !== undefined);
			if (predicates.length === 0) {
				return undefined;
			}
			return filter.type === "and" ? and(...predicates) : or(...predicates);
		},
	);
};

export const compileOptionalFilter = (
	input: FilterInput,
	context: Omit<CompileInput, "now" | "filter">,
): Result.Result<Predicate | undefined, Error> =>
	input.filter === undefined
		? Result.succeed(undefined)
		: compileFilter({ ...context, now: input.now, filter: input.filter });

export const compileFilter = ({
	filter,
	...input
}: CompileInput): Result.Result<Predicate | undefined, Error> =>
	compileNode({ ...input, aliases: new Set(queryAliases(input.source)) }, filter);

export const filterOperatorsFor = (field: FilterFieldSpec): readonly FilterOperator[] =>
	field.kind === "value" ? filterOperators[field.type] : linkFilterOperators;

export const sampleFilterRule = (operator: FilterOperator, spec: FilterFieldSpec): FilterRule => {
	const field = spec.key;
	switch (operator) {
		case "eq":
		case "gte":
		case "lte":
			return { field, operator, value: 1 };
		case "is":
		case "contains":
		case "notContains":
			return { field, operator, value: "sample" };
		case "empty":
		case "isTrue":
		case "isFalse":
		case "notEmpty":
			return { field, operator };
		case "after":
		case "before":
			return { field, operator, value: "2026-01-01" };
		case "anyOf":
		case "allOf":
		case "noneOf": {
			const value =
				spec.kind === "value" && (spec.type === "enum" || spec.type === "enum-list")
					? spec.choices[0].value
					: "sample";
			return { field, operator, values: [value] };
		}
		case "between":
			return { field, min: 1, max: 2, operator };
		case "betweenDates":
			return { field, operator, to: "2026-01-02", from: "2026-01-01" };
		case "withinLastDays":
			return { field, days: 1, operator };
		default:
			return operator satisfies never;
	}
};
