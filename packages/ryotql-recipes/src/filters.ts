import {
	type Filter,
	Filter as FilterSchema,
	type FilterField,
	type FilterOperator,
	filterOperators,
	type FilterRule,
	FilterRule as FilterRuleSchema,
	linkFilterOperators,
	mapFilterFieldReference,
	type QueryFilterField,
	type ValueFilterField,
} from "@ryot-app/contract/modules/filters/schemas";
import {
	type DefinitionOwner,
	ownerIdentityReference,
	QueryEventSchemaReference,
	type QueryOwnerReference,
	QueryRelationshipSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import type {
	FieldSelection,
	NamedQuery,
	Predicate,
	RowsOutput,
	ScalarExpression,
} from "@ryot-app/contract/modules/ryotql/language";
import type { KernelSavedViewRendererName } from "@ryot-app/contract/modules/saved-views/schemas";
import { RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import type { Recipe } from "@ryot-app/ryotql";
import {
	and,
	castBoolean,
	castDate,
	castNumber,
	castText,
	column,
	contains,
	defineRecipe,
	eq,
	eventSchemaPredicate,
	exists,
	groupAscending,
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
	selectedAggregate,
	selectedField,
	selectedMeasure,
	table,
} from "@ryot-app/ryotql";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { DateTime, Result, Schema } from "effect";
import { Base64Url } from "effect/encoding";

export type RowsQuery = NamedQuery & { readonly output: RowsOutput };

export type QueryRelationshipFilterField = Extract<
	QueryFilterField,
	{ readonly kind: "relationship" }
>;

export const collectionsFilterField: QueryRelationshipFilterField = {
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
): readonly QueryFilterField[] => [
	...(settings.filterFields ?? []).map((field) =>
		mapFilterFieldReference<
			{ readonly owner: DefinitionOwner },
			{ readonly owner: QueryOwnerReference }
		>(field, ({ slug, owner }) => ({ slug, owner: ownerIdentityReference(owner) })),
	),
	...(renderer === "results-table" ? [] : [collectionsFilterField]),
];

export type FilterInput =
	| { readonly filter?: undefined; readonly now?: undefined }
	| { readonly filter: Filter; readonly now: DateTime.Utc };

type CompileInput = {
	readonly now: DateTime.Utc;
	readonly filter: Filter;
	readonly source: RowsQuery;
	readonly fields: readonly QueryFilterField[];
	readonly subject: { readonly entityAlias: string } | undefined;
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
		case "anyOf":
			return Result.succeed(loggedFor(rule.values));
		case "allOf":
			return Result.succeed(and(...rule.values.map((value) => loggedFor([value]))));
		case "noneOf":
			return Result.succeed(not(loggedFor(rule.values)));
		case "notEmpty":
			return Result.succeed(logged());
		case "empty":
			return Result.succeed(not(logged()));
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
	if (spec.kind === "session-event") {
		return compileSessionEvent(context, rule, spec);
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
			aliases: new Set([
				input.source.from.alias,
				...(input.source.joins ?? []).map((joined) =>
					joined.type === "jsonElements" ? joined.alias : joined.table.alias,
				),
			]),
		},
		filter,
	);

export const NullableFilter = Schema.NullOr(FilterSchema);

export const filterOperatorsFor = (field: QueryFilterField): readonly FilterOperator[] =>
	field.kind === "value" ? filterOperators[field.type] : linkFilterOperators;

const decodeRule = Schema.decodeUnknownResult(FilterRuleSchema);

const leniently = (node: unknown, fields: readonly QueryFilterField[]): Filter | undefined => {
	if (!isObjectRecord(node)) {
		return undefined;
	}
	if ("field" in node) {
		const rule = decodeRule(node);
		if (Result.isFailure(rule)) {
			return undefined;
		}
		const spec = fields.find(({ key }) => key === rule.success.field);
		if (!spec || !filterOperatorsFor(spec).includes(rule.success.operator)) {
			return undefined;
		}
		return rule.success.operator === "between" && rule.success.min > rule.success.max
			? undefined
			: rule.success;
	}
	if (node["type"] === "not") {
		const inner = leniently(node["filter"], fields);
		return inner && { type: "not", filter: inner };
	}
	if ((node["type"] === "and" || node["type"] === "or") && Array.isArray(node["filters"])) {
		const filters = node["filters"].flatMap((child) => leniently(child, fields) ?? []);
		return filters.length === 0 ? undefined : { filters, type: node["type"] };
	}
	return undefined;
};

export const decodeFilterParam = (
	raw: string | null | undefined,
	fields: readonly QueryFilterField[],
): Filter | undefined => {
	if (raw === null || raw === undefined || raw === "") {
		return undefined;
	}
	const text = Base64Url.decodeString(raw);
	if (Result.isFailure(text)) {
		return undefined;
	}
	return Result.match(
		Result.try({ catch: (error) => error, try: () => JSON.parse(text.success) as unknown }),
		{ onFailure: () => undefined, onSuccess: (node) => leniently(node, fields) },
	);
};

export const encodeFilterParam = (filter: Filter | undefined): string | null =>
	filter === undefined ? null : Base64Url.encode(JSON.stringify(filter));

export const editableGroup = (
	filter: Filter | undefined,
): { readonly match: "all" | "any"; readonly rules: readonly FilterRule[] } | null => {
	if (filter === undefined) {
		return { rules: [], match: "all" };
	}
	if ("field" in filter) {
		return { match: "all", rules: [filter] };
	}
	if (filter.type === "not") {
		return null;
	}
	const rules = filter.filters.filter((child) => "field" in child);
	return rules.length === filter.filters.length
		? { rules, match: filter.type === "and" ? "all" : "any" }
		: null;
};

export const groupFilter = (group: {
	readonly match: "all" | "any";
	readonly rules: readonly FilterRule[];
}): Filter | undefined => {
	const [only, ...rest] = group.rules;
	if (only === undefined) {
		return undefined;
	}
	return rest.length === 0
		? only
		: { filters: group.rules, type: group.match === "all" ? "and" : "or" };
};

export const activeRuleCount = (filter: Filter | undefined): number =>
	editableGroup(filter)?.rules.length ?? 1;

export type FilterDraft = {
	readonly field: string;
	readonly text: string;
	readonly second: string;
	readonly operator: FilterOperator;
	readonly values: readonly string[];
};

export const newFilterDraft = (field: QueryFilterField): FilterDraft => ({
	text: "",
	second: "",
	values: [],
	field: field.key,
	operator: filterOperatorsFor(field)[0] ?? "empty",
});

export const draftFromRule = (rule: FilterRule): FilterDraft => {
	const draft = { text: "", second: "", values: [], field: rule.field, operator: rule.operator };
	if ("values" in rule) {
		return { ...draft, values: rule.values };
	}
	if ("value" in rule) {
		return { ...draft, text: String(rule.value) };
	}
	if ("min" in rule) {
		return { ...draft, text: String(rule.min), second: String(rule.max) };
	}
	if ("from" in rule) {
		return { ...draft, text: rule.from, second: rule.to };
	}
	return "days" in rule ? { ...draft, text: String(rule.days) } : draft;
};

const draftNumber = (text: string) => (text.trim() === "" ? undefined : Number(text));

const draftRuleInput = (draft: FilterDraft): Record<string, unknown> => {
	switch (draft.operator) {
		case "anyOf":
		case "allOf":
		case "noneOf":
			return { values: draft.values };
		case "gte":
		case "lte":
		case "eq":
			return { value: draftNumber(draft.text) };
		case "between":
			return { min: draftNumber(draft.text), max: draftNumber(draft.second) };
		case "before":
		case "after":
		case "contains":
		case "notContains":
		case "is":
			return { value: draft.text === "" ? undefined : draft.text };
		case "betweenDates":
			return { from: draft.text, to: draft.second };
		case "withinLastDays":
			return { days: draftNumber(draft.text) };
		case "empty":
		case "notEmpty":
		case "isTrue":
		case "isFalse":
			break;
	}
	return {};
};

export const draftRule = (draft: FilterDraft): FilterRule | undefined => {
	const rule = decodeRule({
		...draftRuleInput(draft),
		field: draft.field,
		operator: draft.operator,
	});
	if (Result.isFailure(rule)) {
		return undefined;
	}
	return rule.success.operator === "between" && rule.success.min > rule.success.max
		? undefined
		: rule.success;
};

const filterChoicePageSize = 50;

export const LinkedFilterChoicesInput = Schema.Struct({
	searchText: Schema.optionalKey(Schema.String),
	ids: Schema.optionalKey(Schema.Array(Schema.String)),
	link: Schema.Union([
		Schema.Struct({
			kind: Schema.Literal("relationship"),
			relationship: QueryRelationshipSchemaReference,
			direction: Schema.Literals(["outgoing", "incoming"]),
		}),
		Schema.Struct({ event: QueryEventSchemaReference, kind: Schema.Literal("session-event") }),
	]),
});

export const linkedFilterChoicesInput = (
	field: Exclude<QueryFilterField, { readonly kind: "value" }>,
	input: { readonly searchText?: string; readonly ids?: readonly string[] },
): typeof LinkedFilterChoicesInput.Type => ({
	...input,
	link:
		field.kind === "relationship"
			? { kind: "relationship", direction: field.direction, relationship: field.relationship }
			: { event: field.event, kind: "session-event" },
});

const linkedChoicesSource = (
	link: typeof LinkedFilterChoicesInput.Type.link,
	far: ReturnType<typeof table>,
) => {
	if (link.kind === "relationship") {
		const from = table("relationship", "filterChoiceLink");
		return {
			from,
			farColumn: link.direction === "outgoing" ? "targetEntityId" : "sourceEntityId",
			where: relationshipSchemaPredicate(from, link.relationship.slug, link.relationship.owner),
		};
	}
	const from = table("event", "filterChoiceEvent");
	return {
		from,
		farColumn: "entityId",
		where: and(
			eventSchemaPredicate(
				from,
				far,
				link.event.entitySchemaSlug,
				link.event.slug,
				link.event.owner,
			),
			isNotNull(column(from, "sessionEntityId")),
		),
	};
};

export const linkedFilterChoicesRecipe = defineRecipe(
	(input: typeof LinkedFilterChoicesInput.Type) => {
		const far = table("entity", "filterChoiceEntity");
		const search = input.searchText?.trim();
		const source = linkedChoicesSource(input.link, far);
		return {
			map: ({ choices }) =>
				Result.succeed(choices.items.map(({ id, name }) => ({ value: id, label: name }))),
			queries: {
				choices: selectedAggregate(source.from, {
					limit: filterChoicePageSize,
					orderBy: [groupAscending("name"), groupAscending("id")],
					measures: { links: selectedMeasure({ function: "count" }, Schema.Finite) },
					joins: [join("inner", far, eq(column(source.from, source.farColumn), column(far, "id")))],
					groupBy: {
						id: selectedField(column(far, "id"), Schema.String),
						name: selectedField(column(far, "name"), Schema.String),
					},
					where: and(
						source.where,
						...(input.ids === undefined
							? []
							: [inArray(column(far, "id"), textLiterals(input.ids))]),
						...(search ? [contains(column(far, "name"), literal(search))] : []),
					),
				}),
			},
		};
	},
);

export type LinkedFilterChoices = Recipe.Success<typeof linkedFilterChoicesRecipe>;
