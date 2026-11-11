import {
	ratingRange,
	type RatingScale,
	scaledRangeBound,
} from "@ryot-app/contract/modules/events/rating-scale";
import {
	type Filter,
	Filter as FilterSchema,
	type FilterField,
	type FilterOperator,
	type FilterRule,
	FilterRule as FilterRuleSchema,
	mapFilterFieldReference,
	type QueryFilterField,
} from "@ryot-app/contract/modules/filters/schemas";
import {
	type DefinitionOwner,
	ownerIdentityReference,
	QueryEventSchemaReference,
	type QueryOwnerReference,
	QueryRelationshipSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import { relationshipEnds } from "@ryot-app/contract/modules/relationships/orientation";
import { RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import type { Recipe } from "@ryot-app/ryotql";
import {
	and,
	column,
	contains,
	countAll,
	defineRecipe,
	eq,
	eventSchemaPredicate,
	groupAscending,
	inArray,
	isNotNull,
	join,
	relationshipSchemaPredicate,
	selectedAggregate,
	selectedField,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import {
	type FilterFieldSpec,
	filterOperatorsFor,
	type FilterTarget,
	type QueryRelationshipFilterField,
} from "@ryot-app/ryotql/filters";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Result, Schema } from "effect";
import { Base64Url } from "effect/encoding";

export const collectionsFilterField = {
	key: "collections",
	label: "Collections",
	kind: "relationship",
	direction: "outgoing",
	relationship: { owner: { kind: "kernel" }, slug: RelationshipSchemaSlug.make("member-of") },
} as const satisfies QueryRelationshipFilterField;

export const collectionsFilterTarget: FilterTarget = {
	branches: [{}],
	spec: collectionsFilterField,
};

export const queryFilterFields = (fields: readonly FilterField[]): readonly QueryFilterField[] =>
	fields.map((field) =>
		mapFilterFieldReference<
			{ readonly owner: DefinitionOwner },
			{ readonly owner: QueryOwnerReference }
		>(field, ({ slug, owner }) => ({ slug, owner: ownerIdentityReference(owner) })),
	);

export const NullableFilter = Schema.NullOr(FilterSchema);

const decodeRule = Schema.decodeUnknownResult(FilterRuleSchema);
const decodeJson = Schema.decodeResult(Schema.fromJsonString(Schema.Unknown));

const leniently = (node: unknown, fields: readonly FilterFieldSpec[]): Filter | undefined => {
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
	raw: null | string | undefined,
	fields: readonly FilterFieldSpec[],
): Filter | undefined => {
	if (raw === null || raw === undefined || raw === "") {
		return undefined;
	}
	const text = Base64Url.decodeString(raw);
	if (Result.isFailure(text)) {
		return undefined;
	}
	return Result.match(decodeJson(text.success), {
		onFailure: () => undefined,
		onSuccess: (node) => leniently(node, fields),
	});
};

export const encodeFilterParam = (filter: Filter | undefined): null | string =>
	filter === undefined ? null : Base64Url.encode(JSON.stringify(filter));

export const editableGroup = (
	filter: Filter | undefined,
): null | { readonly match: "all" | "any"; readonly rules: readonly FilterRule[] } => {
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
	readonly text: string;
	readonly field: string;
	readonly second: string;
	readonly operator: FilterOperator;
	readonly values: readonly string[];
};

export const newFilterDraft = (field: FilterFieldSpec): FilterDraft => ({
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
		case "eq":
		case "gte":
		case "lte":
			return { value: draftNumber(draft.text) };
		case "is":
		case "after":
		case "before":
		case "contains":
		case "notContains":
			return { value: draft.text === "" ? undefined : draft.text };
		case "anyOf":
		case "allOf":
		case "noneOf":
			return { values: draft.values };
		case "empty":
		case "isTrue":
		case "isFalse":
		case "notEmpty":
			break;
		case "between":
			return { min: draftNumber(draft.text), max: draftNumber(draft.second) };
		case "betweenDates":
			return { from: draft.text, to: draft.second };
		case "withinLastDays":
			return { days: draftNumber(draft.text) };
	}
	return {};
};

export const draftRule = (draft: FilterDraft): undefined | FilterRule => {
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

const scaledBound = (stored: number, bound: "min" | "max", scale: RatingScale) =>
	String(scaledRangeBound(stored, bound, scale));

/** A draft whose rating bounds are in the user's scale, from a rule stored on 0–100. */
export const ratingDraftFromRule = (rule: FilterRule, scale: RatingScale): FilterDraft => {
	const draft = draftFromRule(rule);
	if (rule.operator === "gte") {
		return { ...draft, text: scaledBound(rule.value, "min", scale) };
	}
	if (rule.operator === "lte") {
		return { ...draft, text: scaledBound(rule.value, "max", scale) };
	}
	return rule.operator === "between"
		? {
				...draft,
				text: scaledBound(rule.min, "min", scale),
				second: scaledBound(rule.max, "max", scale),
			}
		: draft;
};

export const ratingDraftRule = (draft: FilterDraft, scale: RatingScale): undefined | FilterRule => {
	const rule = draftRule(draft);
	if (rule?.operator === "gte") {
		return { ...rule, value: ratingRange(rule.value, scale).min };
	}
	if (rule?.operator === "lte") {
		return { ...rule, value: ratingRange(rule.value, scale).max };
	}
	return rule?.operator === "between"
		? { ...rule, min: ratingRange(rule.min, scale).min, max: ratingRange(rule.max, scale).max }
		: rule;
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
	field: Exclude<FilterFieldSpec, { readonly kind: "value" }>,
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
			farColumn: `${relationshipEnds(link.direction).related}EntityId` as const,
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

export const linkedFilterChoicesRecipe = (
	input: Pick<typeof LinkedFilterChoicesInput.Type, "link">,
) => {
	const recipeParameters = parameters({
		fields: {
			searchText: { type: "string", label: "searchText", description: "Query searchText" },
			ids: {
				label: "ids",
				type: "array",
				description: "Query ids",
				items: {
					label: "ID",
					type: "string",
					validation: { required: true },
					description: "Selected entity ID",
				},
			},
		},
	});

	const far = table("entity", "filterChoiceEntity");

	const source = linkedChoicesSource(input.link, far);
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ choices }) =>
			Result.succeed(choices.items.map(({ id, name }) => ({ value: id, label: name }))),
		queries: {
			choices: selectedAggregate(source.from, {
				limit: filterChoicePageSize,
				measures: { links: countAll },
				orderBy: [groupAscending("name"), groupAscending("id")],
				joins: [join("inner", far, eq(column(source.from, source.farColumn), column(far, "id")))],
				groupBy: {
					id: selectedField(column(far, "id"), Schema.String),
					name: selectedField(column(far, "name"), Schema.String),
				},
				where: and(
					source.where,
					recipeParameters.whenSet("ids", inArray(column(far, "id"), recipeParameters.list("ids"))),
					recipeParameters.whenSet(
						"searchText",
						contains(column(far, "name"), recipeParameters.value("searchText")),
					),
				),
			}),
		},
	});
};

export type LinkedFilterChoices = Recipe.Success<ReturnType<typeof linkedFilterChoicesRecipe>>;
