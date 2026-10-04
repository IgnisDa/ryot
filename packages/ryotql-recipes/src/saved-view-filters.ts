import { ownerIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import type {
	FieldSelection,
	NamedQuery,
	Predicate,
	RowsOutput,
	ScalarExpression,
} from "@ryot-app/contract/modules/ryotql/language";
import {
	filterOperators,
	type Filter,
	type FilterField,
	type FilterRule,
	type RelationshipFilterField,
	type ValueFilterField,
} from "@ryot-app/contract/modules/saved-views/filters";
import type {
	KernelSavedViewRendererName,
	SavedViewSubject,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	and,
	castBoolean,
	castDate,
	castNumber,
	castText,
	column,
	contains,
	eq,
	exists,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	jsonArrayExists,
	jsonElement,
	literal,
	lt,
	lte,
	not,
	or,
	relationshipSchemaPredicate,
	table,
} from "@ryot-app/ryotql";
import { DateTime, Result } from "effect";

export type RowsQuery = NamedQuery & { readonly output: RowsOutput };

const collectionsFilterField: RelationshipFilterField = {
	key: "collections",
	label: "Collections",
	kind: "relationship",
	direction: "outgoing",
	relationship: { owner: { kind: "kernel" }, slug: RelationshipSchemaSlug.make("member-of") },
};

export const reservedFilterFieldKeys: readonly string[] = [collectionsFilterField.key];

export const effectiveFilterFields = (
	renderer: KernelSavedViewRendererName,
	settings: { readonly filterFields?: readonly FilterField[] | undefined },
): readonly FilterField[] => [
	...(settings.filterFields ?? []),
	...(renderer === "results-table" ? [] : [collectionsFilterField]),
];

export type FilterInput =
	| { readonly filter?: undefined; readonly now?: undefined }
	| { readonly filter: Filter; readonly now: DateTime.Utc };

type CompileInput = {
	readonly now: DateTime.Utc;
	readonly filter: Filter;
	readonly source: RowsQuery;
	readonly fields: readonly FilterField[];
	readonly subject: SavedViewSubject | undefined;
};

type CompileContext = Omit<CompileInput, "filter"> & { readonly aliases: Set<string> };

const failure = (message: string) => Result.fail(new Error(message));

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
	spec: RelationshipFilterField,
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
				relationshipSchemaPredicate(
					alias,
					spec.relationship.slug,
					ownerIdentityReference(spec.relationship.owner),
				),
				eq(column(alias, ownColumn), entityId),
				...extra.map((predicate) => predicate(alias)),
			),
		});
	};
	const linkedTo = (ids: readonly string[]) =>
		linked((alias) => inArray(column(alias, otherColumn), textLiterals(ids)));
	switch (rule.operator) {
		case "anyOf":
			return Result.succeed(linkedTo(rule.values));
		case "allOf":
			return Result.succeed(and(...rule.values.map((value) => linkedTo([value]))));
		case "noneOf":
			return Result.succeed(not(linkedTo(rule.values)));
		case "notEmpty":
			return Result.succeed(linked());
		case "empty":
			return Result.succeed(not(linked()));
		case "gte":
		case "lte":
		case "eq":
		case "between":
		case "before":
		case "after":
		case "betweenDates":
		case "withinLastDays":
		case "contains":
		case "notContains":
		case "is":
		case "isTrue":
		case "isFalse":
			break;
	}
	return unavailable(rule, spec.key);
};

const compileList = (
	expr: ScalarExpression,
	rule: FilterRule,
	spec: ValueFilterField,
): Result.Result<Predicate, Error> => {
	switch (rule.operator) {
		case "anyOf":
			return Result.succeed(jsonArrayExists(expr, inArray(element(), textLiterals(rule.values))));
		case "allOf":
			return Result.succeed(
				and(...rule.values.map((value) => jsonArrayExists(expr, eq(element(), literal(value))))),
			);
		case "noneOf":
			return Result.succeed(
				not(jsonArrayExists(expr, inArray(element(), textLiterals(rule.values)))),
			);
		case "contains":
			return Result.succeed(jsonArrayExists(expr, contains(element(), literal(rule.value))));
		case "notEmpty":
			return Result.succeed(jsonArrayExists(expr));
		case "empty":
			return Result.succeed(or(isNull(expr), not(jsonArrayExists(expr))));
		case "notContains":
		case "is":
		case "gte":
		case "lte":
		case "eq":
		case "between":
		case "before":
		case "after":
		case "betweenDates":
		case "withinLastDays":
		case "isTrue":
		case "isFalse":
			break;
	}
	return unavailable(rule, spec.key);
};

const compileScalar = (
	now: DateTime.Utc,
	expr: ScalarExpression,
	rule: FilterRule,
	spec: ValueFilterField,
): Result.Result<Predicate, Error> => {
	const text = castText(expr);
	const number = castNumber(expr);
	const date = castDate(expr);
	switch (rule.operator) {
		case "empty":
			return Result.succeed(isNull(expr));
		case "notEmpty":
			return Result.succeed(isNotNull(expr));
		case "anyOf":
			return Result.succeed(inArray(text, textLiterals(rule.values)));
		case "noneOf":
			return Result.succeed(or(isNull(expr), not(inArray(text, textLiterals(rule.values)))));
		case "contains":
			return Result.succeed(contains(text, literal(rule.value)));
		case "notContains":
			return Result.succeed(or(isNull(expr), not(contains(text, literal(rule.value)))));
		case "is":
			return Result.succeed(eq(text, literal(rule.value)));
		case "gte":
			return Result.succeed(gte(number, literal(rule.value)));
		case "lte":
			return Result.succeed(lte(number, literal(rule.value)));
		case "eq":
			return Result.succeed(eq(number, literal(rule.value)));
		case "between":
			return rule.min > rule.max
				? failure(`Range for field '${spec.key}' must not be inverted`)
				: Result.succeed(and(gte(number, literal(rule.min)), lte(number, literal(rule.max))));
		case "before":
			return Result.succeed(lt(date, isoDate(rule.value)));
		case "after":
			return Result.succeed(gt(date, isoDate(rule.value)));
		case "betweenDates":
			return Result.succeed(and(gte(date, isoDate(rule.from)), lte(date, isoDate(rule.to))));
		case "withinLastDays":
			return Result.succeed(
				gte(date, isoDate(DateTime.formatIso(DateTime.subtract(now, { days: rule.days })))),
			);
		case "isTrue":
			return Result.succeed(eq(castBoolean(expr), literal(true)));
		case "isFalse":
			return Result.succeed(eq(castBoolean(expr), literal(false)));
		case "allOf":
			break;
	}
	return unavailable(rule, spec.key);
};

const selectedExpression = (source: RowsQuery, key: string) =>
	source.output.fields.find(
		(selection): selection is FieldSelection => "key" in selection && selection.key === key,
	)?.expr;

const compileRule = (
	context: CompileContext,
	rule: FilterRule,
): Result.Result<Predicate, Error> => {
	const spec = context.fields.find(({ key }) => key === rule.field);
	if (!spec) {
		return failure(`Unknown filter field '${rule.field}'`);
	}
	if (spec.kind === "relationship") {
		return compileRelationship(context, rule, spec);
	}
	const operators: readonly string[] = filterOperators[spec.type];
	if (!operators.includes(rule.operator)) {
		return unavailable(rule, spec.key);
	}
	const expr = selectedExpression(context.source, spec.field);
	if (!expr) {
		return failure(`Filter field '${spec.key}' references missing output field '${spec.field}'`);
	}
	return spec.type === "enum-list" || spec.type === "text-list"
		? compileList(expr, rule, spec)
		: compileScalar(context.now, expr, rule, spec);
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
	context: Omit<CompileInput, "filter" | "now">,
): Result.Result<Predicate | undefined, Error> =>
	input.filter === undefined
		? Result.succeed(undefined)
		: compileFilter({ ...context, now: input.now, filter: input.filter });

export const compileFilter = ({
	filter,
	...input
}: CompileInput): Result.Result<Predicate | undefined, Error> =>
	compileNode(
		{
			...input,
			aliases: new Set(
				[input.source.from, ...(input.source.joins ?? []).map(({ table: joined }) => joined)].map(
					({ alias }) => alias,
				),
			),
		},
		filter,
	);
