import {
	BROWSE_SUBJECT_ALIAS,
	type BrowseValueField,
} from "@ryot-app/contract/modules/filters/browse";
import {
	definitionOwner,
	ownerIdentityReference,
} from "@ryot-app/contract/modules/plugins/references";
import { scalarExpressionTables } from "@ryot-app/contract/modules/ryotql/authored";
import { entityBrowserFields } from "@ryot-app/contract/modules/saved-views/entity-browser-fields";
import type {
	EntityBrowserSavedViewSettings,
	SavedViewDisplayValue,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	conditional,
	contains,
	countAll,
	defineRecipe,
	document,
	eq,
	field,
	groupAscending,
	inArray,
	or,
	rows,
	selectedAggregate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { filter, parameters, sort } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

import type { BrowseSchema } from "./browse";

const PUBLICATION_SOURCE = "source";
const PUBLICATION_SUBJECT_ALIAS = "subject";

export type PublicationSubjectSchema = { readonly slug: string; readonly pluginId: null | string };

/** Keeps the value and sort fields a publication can serve: those reading only the browsed entities. */
export const publicationBrowse = (browse: readonly BrowseSchema[]): readonly BrowseSchema[] =>
	browse.map((schema) => ({
		...schema,
		browse:
			schema.browse === null
				? null
				: {
						fields: schema.browse.fields.filter(
							(browseField) =>
								(browseField.kind === "value" || browseField.kind === "sort") &&
								[...scalarExpressionTables(browseField.expression)].every(
									(name) => name === "entity",
								),
						),
					},
	}));

export const publicationSubjectSchemasRecipe = (() => {
	const subject = table("entity", PUBLICATION_SUBJECT_ALIAS);
	return defineRecipe({
		map: ({ schemas }) =>
			Result.succeed(schemas.items.map(({ slug, pluginId }) => ({ slug, pluginId }))),
		queries: {
			schemas: selectedAggregate(subject, {
				limit: 1000,
				measures: { count: countAll },
				orderBy: [groupAscending("pluginId"), groupAscending("slug")],
				groupBy: {
					slug: selectedField(column(subject, "entitySchemaSlug"), Schema.String),
					pluginId: selectedField(
						column(subject, "entitySchemaPluginId"),
						Schema.NullOr(Schema.String),
					),
				},
			}),
		},
	});
})();

export const publicationBrowserSource = (
	schemas: readonly [PublicationSubjectSchema, ...PublicationSubjectSchema[]],
) => {
	const subject = table("entity", PUBLICATION_SUBJECT_ALIAS);
	const reference = (schema: PublicationSubjectSchema) => ({
		owner: definitionOwner(schema.pluginId),
		slug: EntitySchemaSlug.make(schema.slug),
	});
	const [first, ...rest] = schemas;
	const input = parameters({
		fields: {
			search: { type: "string", label: "Search", description: "Published item name contains" },
			ids: {
				type: "array",
				label: "Entities",
				description: "Published entity IDs",
				items: {
					label: "ID",
					type: "string",
					validation: { required: true },
					description: "Published entity ID",
				},
			},
		},
	});
	const target = {
		kind: "browse",
		alias: subject.alias,
		schemas: [
			{ slug: first.slug, owner: ownerIdentityReference(definitionOwner(first.pluginId)) },
			...rest.map((schema) => ({
				slug: schema.slug,
				owner: ownerIdentityReference(definitionOwner(schema.pluginId)),
			})),
		],
	} as const;
	const where = and(
		input.whenSet("search", contains(column(subject, "name"), input.value("search"))),
		input.whenSet("ids", inArray(column(subject, "id"), input.list("ids"))),
		filter(),
	);
	const source = rows(subject, {
		where,
		limit: 24,
		maxLimit: 100,
		orderBy: sort([
			ascending(column(subject, "publicationRank")),
			ascending(column(subject, "id")),
		]),
		fields: [
			field("name", column(subject, "name")),
			field(entityBrowserFields.id, column(subject, "id")),
			field(entityBrowserFields.name, column(subject, "name")),
			field(entityBrowserFields.owner, column(subject, "entitySchemaPluginId")),
			field(entityBrowserFields.schema, column(subject, "entitySchemaSlug")),
			field(entityBrowserFields.population, column(subject, "populationStatus")),
			field(entityBrowserFields.translation, column(subject, "translationStatus")),
		],
	});
	return {
		settings: {
			pageSize: 24,
			addAction: null,
			tableColumns: null,
			defaultLayout: "grid",
			layouts: ["grid", "list"],
			sourceName: PUBLICATION_SOURCE,
			summary: { image: null, subtitle: null },
			controls: { sort: true, filter: true, search: "search" },
			subject: {
				entityAlias: PUBLICATION_SUBJECT_ALIAS,
				schemas: [reference(first), ...rest.map(reference)],
			},
		} satisfies EntityBrowserSavedViewSettings,
		dataSources: {
			...document({
				[PUBLICATION_SOURCE]: source,
				ids: rows(subject, {
					where,
					limit: 100,
					maxLimit: 100,
					orderBy: [ascending(column(subject, "id"))],
					fields: [field("id", column(subject, "id"))],
				}),
				count: {
					...source,
					output: {
						limit: 1,
						maxLimit: 1,
						type: "aggregate" as const,
						measures: [
							{
								key: "count",
								aggregation: { expr: column(subject, "id"), function: "countDistinct" as const },
							},
						],
					},
				},
			}),
			parameters: input.schema,
			controls: { sort: target, filter: target },
		},
	};
};

const DetailValue = Schema.NullOr(
	Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, Schema.Array(Schema.String)]),
);

export type PublicationItemDetail = {
	readonly key: string;
	readonly label: string;
	readonly value: SavedViewDisplayValue;
};

const choiceLabel = (browseField: BrowseValueField, value: string) =>
	("choices" in browseField
		? browseField.choices.find((choice) => choice.value === value)?.label
		: undefined) ?? value;

const itemDetail = (
	browseField: BrowseValueField,
	value: undefined | typeof DetailValue.Type,
): readonly PublicationItemDetail[] => {
	const base = { key: browseField.key, label: browseField.label };
	if (typeof value === "number") {
		return [{ ...base, value: { value, displayKind: "number" } }];
	}
	if (typeof value === "boolean") {
		return [{ ...base, value: { value, displayKind: "boolean" } }];
	}
	if (typeof value === "object" && value !== null) {
		const items = value.flatMap((item) => (item === "" ? [] : [choiceLabel(browseField, item)]));
		return items.length === 0
			? []
			: [{ ...base, value: { displayKind: "text", value: items.join(", ") } }];
	}
	if (typeof value !== "string" || value === "") {
		return [];
	}
	return [
		{
			...base,
			value:
				browseField.type === "date"
					? { value, displayKind: "date" }
					: { displayKind: "text", value: choiceLabel(browseField, value) },
		},
	];
};

/** Reads one published item's browse values; fields must read only the browsed entity. */
export const publicationItemDetailsRecipe = (input: {
	readonly fields: readonly BrowseValueField[];
}) => {
	const recipeParameters = parameters({
		fields: {
			entityId: {
				type: "string",
				label: "entityId",
				description: "Query argument",
				validation: { required: true },
			},
		},
	});

	const subject = table("entity", BROWSE_SUBJECT_ALIAS);
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ item }) =>
			Result.succeed(
				item === undefined
					? []
					: input.fields.flatMap((browseField) => itemDetail(browseField, item[browseField.key])),
			),
		queries: {
			item: selectedOptionalRow(subject, {
				orderBy: [ascending(column(subject, "id"))],
				where: eq(column(subject, "id"), recipeParameters.value("entityId")),
				selection: Object.fromEntries(
					input.fields.map((browseField) => [
						browseField.key,
						selectedField(browseField.expression, DetailValue),
					]),
				),
			}),
		},
	});
};

/** The other published items linked to this one, in either direction. */
const linkParameters = parameters({
	fields: {
		entityId: {
			type: "string",
			label: "Entity",
			validation: { required: true },
			description: "Published entity ID",
		},
	},
});
const publicationLink = table("relationship", "link");
export const publicationItemLinksRecipe = defineRecipe({
	parameters: linkParameters.schema,
	map: ({ links }) => Result.succeed([...new Set(links.items.map(({ entityId }) => entityId))]),
	queries: {
		links: selectedRows(publicationLink, {
			limit: 100,
			orderBy: [ascending(column(publicationLink, "id"))],
			where: or(
				eq(column(publicationLink, "sourceEntityId"), linkParameters.value("entityId")),
				eq(column(publicationLink, "targetEntityId"), linkParameters.value("entityId")),
			),
			selection: {
				entityId: selectedField(
					conditional(
						eq(column(publicationLink, "sourceEntityId"), linkParameters.value("entityId")),
						column(publicationLink, "targetEntityId"),
						column(publicationLink, "sourceEntityId"),
					),
					Schema.String,
				),
			},
		}),
	},
});
