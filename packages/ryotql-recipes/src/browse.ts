import {
	BROWSE_SUBJECT_ALIAS,
	type BrowseField,
	type BrowseSort,
	EntitySchemaBrowse,
} from "@ryot-app/contract/modules/filters/browse";
import type { FilterChoice } from "@ryot-app/contract/modules/filters/schemas";
import {
	definitionOwner,
	ownerIdentityReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	mapScalarExpression,
	type OrderBy,
	type Predicate,
	type ScalarExpression,
	type TableReference,
} from "@ryot-app/contract/modules/ryotql/language";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	conditional,
	defineRecipe,
	descending,
	entitySchemaPredicate,
	eq,
	literal,
	or,
	type Recipe,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import {
	collectionsFilterField,
	type FilterFieldSpec,
	type FilterTarget,
	queryFilterFields,
} from "./filters";

const NAME_SORT_KEY = "name";

export const reservedBrowseFieldKeys: readonly string[] = [
	collectionsFilterField.key,
	NAME_SORT_KEY,
];

export type BrowseSchema = {
	readonly slug: string;
	readonly pluginId: null | string;
	readonly browse: null | EntitySchemaBrowse;
};

export type SortTarget = {
	readonly key: string;
	readonly labels: BrowseSort;
	readonly branches: readonly [SortBranch, ...SortBranch[]];
};

type SortBranch = { readonly value: ScalarExpression; readonly when?: Predicate | undefined };

export const nameSortTarget = (entity: TableReference): SortTarget => ({
	key: NAME_SORT_KEY,
	branches: [{ value: column(entity, "name") }],
	labels: { ascending: "Name A-Z", descending: "Name Z-A" },
});

export const sortChoices = (targets: readonly SortTarget[]) =>
	targets.flatMap(({ key, labels }) => [
		{ value: `${key}-asc`, label: labels.ascending },
		{ value: `${key}-desc`, label: labels.descending },
	]);

const sortValue = (branches: readonly SortBranch[]) =>
	branches.reduceRight<ScalarExpression>(
		(otherwise, branch) =>
			branch.when === undefined ? branch.value : conditional(branch.when, branch.value, otherwise),
		literal(null),
	);

/** Orders by a sort choice, then entity ID; rows without a value sort last. */
export const compileSort = (
	targets: readonly SortTarget[],
	choice: string,
	entityId: ScalarExpression,
): Result.Result<readonly OrderBy[], Error> => {
	for (const target of targets) {
		if (choice === `${target.key}-asc`) {
			return Result.succeed([ascending(sortValue(target.branches)), ascending(entityId)]);
		}
		if (choice === `${target.key}-desc`) {
			return Result.succeed([descending(sortValue(target.branches)), ascending(entityId)]);
		}
	}
	return Result.fail(new Error(`Sort choice '${choice}' is not available`));
};

const schemaOwner = (schema: BrowseSchema) =>
	ownerIdentityReference(definitionOwner(schema.pluginId));

type LinkSpec = Exclude<FilterFieldSpec, { readonly kind: "value" }>;

type Declaration = { readonly field: BrowseField; readonly schema: BrowseSchema };

const rebase = (
	expression: ScalarExpression,
	entityAlias: string,
	prefix: string,
	usedAliases: ReadonlySet<string>,
) => {
	const renamed = new Map<string, string>();
	return mapScalarExpression(expression, {
		alias: (alias) => {
			if (alias === BROWSE_SUBJECT_ALIAS) {
				return entityAlias;
			}
			let next = renamed.get(alias);
			if (next === undefined) {
				next = `${prefix}${alias}`;
				while (usedAliases.has(next)) {
					next = `_${next}`;
				}
				renamed.set(alias, next);
			}
			return next;
		},
	});
};

const mergedChoices = (declarations: readonly Declaration[]) => {
	const choices = new Map<string, typeof FilterChoice.Type>();
	for (const { field } of declarations) {
		for (const choice of field.kind === "value" && "choices" in field ? field.choices : []) {
			if (!choices.has(choice.value)) {
				choices.set(choice.value, choice);
			}
		}
	}
	return [...choices.values()];
};

/**
 * Filter and sort targets for browse fields declared by `schemas`. Fields with the same plugin and
 * key merge; each member reads its own schema's expression and members of other schemas never
 * match or sort first.
 */
export const browseTargets = (
	schemas: readonly BrowseSchema[],
	entity: TableReference,
	usedAliases: ReadonlySet<string>,
) => {
	const groups = new Map<string, Declaration[]>();
	for (const schema of schemas) {
		for (const field of schema.browse?.fields ?? []) {
			const groupKey = JSON.stringify([schema.pluginId, field.key]);
			groups.set(groupKey, [...(groups.get(groupKey) ?? []), { field, schema }]);
		}
	}
	const keyCounts = new Map<string, number>();
	for (const [first] of groups.values()) {
		if (first) {
			keyCounts.set(first.field.key, (keyCounts.get(first.field.key) ?? 0) + 1);
		}
	}
	let prefixIndex = 0;
	const conditionFor = (declarations: readonly Declaration[]) =>
		declarations.length === schemas.length
			? undefined
			: or(
					...declarations.map(({ schema }) =>
						entitySchemaPredicate(entity, schema.slug, schemaOwner(schema)),
					),
				);
	const valueBranches = (
		declarations: readonly Declaration[],
		expression: (field: BrowseField) => undefined | ScalarExpression,
	) => {
		const byExpression = new Map<
			string,
			{ value: ScalarExpression; declarations: Declaration[] }
		>();
		for (const declaration of declarations) {
			const value = expression(declaration.field);
			if (value === undefined) {
				continue;
			}
			const expressionKey = JSON.stringify(value);
			const existing = byExpression.get(expressionKey);
			if (existing) {
				existing.declarations.push(declaration);
			} else {
				byExpression.set(expressionKey, { value, declarations: [declaration] });
			}
		}
		return [...byExpression.values()].map(({ value, declarations: matching }) => ({
			when: conditionFor(matching),
			value: rebase(value, entity.alias, `browse${prefixIndex++}_`, usedAliases),
		}));
	};
	const linkBranches = (declarations: readonly Declaration[], key: string) => {
		const byLink = new Map<string, { link: LinkSpec; declarations: Declaration[] }>();
		for (const declaration of declarations) {
			const [link] = queryFilterFields(
				declaration.field.kind === "relationship" || declaration.field.kind === "session-event"
					? [{ ...declaration.field, key }]
					: [],
			);
			if (link === undefined || link.kind === "value") {
				continue;
			}
			const linkKey = JSON.stringify(link);
			const existing = byLink.get(linkKey);
			if (existing) {
				existing.declarations.push(declaration);
			} else {
				byLink.set(linkKey, { link, declarations: [declaration] });
			}
		}
		return [...byLink.values()].map(({ link, declarations: matching }) => ({
			link,
			when: conditionFor(matching),
		}));
	};
	const filters: FilterTarget[] = [];
	const sorts: SortTarget[] = [];
	for (const declarations of groups.values()) {
		const [first] = declarations;
		if (!first) {
			continue;
		}
		const { field, schema } = first;
		const key =
			keyCounts.get(field.key) === 1 ? field.key : `${field.key}:${schema.pluginId ?? "kernel"}`;
		const sortLabels = declarations.flatMap(({ field: declared }) =>
			declared.kind === "sort" || (declared.kind === "value" && declared.sort)
				? [declared.sort]
				: [],
		)[0];
		if (sortLabels) {
			const [branch, ...otherBranches] = valueBranches(declarations, (declared) =>
				declared.kind === "sort" || (declared.kind === "value" && declared.sort)
					? declared.expression
					: undefined,
			);
			if (branch) {
				sorts.push({ key, labels: sortLabels, branches: [branch, ...otherBranches] });
			}
		}
		if (field.kind === "sort") {
			continue;
		}
		if (field.kind !== "value") {
			const [linkBranch, ...otherLinks] = linkBranches(declarations, key);
			if (linkBranch) {
				filters.push({ spec: linkBranch.link, branches: [linkBranch, ...otherLinks] });
			}
			continue;
		}
		const [, ...otherChoices] = mergedChoices(declarations);
		const spec: FilterFieldSpec =
			"choices" in field
				? {
						key,
						kind: "value",
						type: field.type,
						label: field.label,
						choices: [field.choices[0], ...otherChoices],
					}
				: { key, kind: "value", type: field.type, label: field.label };
		const [branch, ...otherBranches] = valueBranches(declarations, (declared) =>
			declared.kind === "value" ? declared.expression : undefined,
		);
		if (branch) {
			filters.push({ spec, branches: [branch, ...otherBranches] });
		}
	}
	return { sorts, filters };
};

const definitions = table("entitySchema", "browseSchema");

export const entitySchemaBrowseRecipe = defineRecipe(
	(input: {
		readonly schemas: readonly [
			{ readonly slug: string; readonly pluginId: null | string },
			...{ readonly slug: string; readonly pluginId: null | string }[],
		];
	}) => ({
		map: ({ schemas }) =>
			Result.succeed(
				input.schemas.flatMap((requested) =>
					schemas.items.filter(
						(row) => row.slug === requested.slug && row.pluginId === requested.pluginId,
					),
				),
			),
		queries: {
			schemas: selectedRows(definitions, {
				limit: input.schemas.length,
				orderBy: [ascending(column(definitions, "id"))],
				where: or(
					...input.schemas.map((schema) =>
						and(
							eq(column(definitions, "slug"), literal(schema.slug)),
							schemaOwnerPredicate(
								definitions,
								"pluginId",
								schemaOwner({ ...schema, browse: null }),
							),
						),
					),
				),
				selection: {
					slug: selectedField(column(definitions, "slug"), EntitySchemaSlug),
					pluginId: selectedField(column(definitions, "pluginId"), Schema.NullOr(Schema.String)),
					browse: selectedField(column(definitions, "browse"), Schema.NullOr(EntitySchemaBrowse)),
				},
			}),
		},
	}),
);

export type EntitySchemaBrowseResult = Recipe.Success<typeof entitySchemaBrowseRecipe>;
