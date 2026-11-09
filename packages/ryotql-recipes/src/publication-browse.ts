import {
	BROWSE_SUBJECT_ALIAS,
	type BrowseValueField,
} from "@ryot-app/contract/modules/filters/browse";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { scalarExpressionTables } from "@ryot-app/contract/modules/ryotql/language";
import type {
	EntityBrowserSavedViewSettings,
	SavedViewDisplayValue,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	ascending,
	column,
	countAll,
	defineRecipe,
	document,
	eq,
	field,
	groupAscending,
	inArray,
	literal,
	or,
	rows,
	selectedAggregate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import type { BrowseSchema } from "./browse";
import { collectionsFilterTarget } from "./filters";
import { entityBrowserControls } from "./saved-views";

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

export const publicationBrowserControls = (browse: readonly BrowseSchema[]) => {
	const controls = entityBrowserControls(browse);
	return {
		...controls,
		filterFields: controls.filterFields.filter(
			({ key }) => key !== collectionsFilterTarget.spec.key,
		),
	};
};

export const publicationSubjectSchemasRecipe = defineRecipe(() => {
	const subject = table("entity", PUBLICATION_SUBJECT_ALIAS);
	return {
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
	};
});

export const publicationBrowserSource = (
	schemas: readonly [PublicationSubjectSchema, ...PublicationSubjectSchema[]],
	entityIds?: readonly string[],
) => {
	const subject = table("entity", PUBLICATION_SUBJECT_ALIAS);
	const reference = (schema: PublicationSubjectSchema) => ({
		owner: definitionOwner(schema.pluginId),
		slug: EntitySchemaSlug.make(schema.slug),
	});
	const [first, ...rest] = schemas;
	return {
		dataSources: document({
			[PUBLICATION_SOURCE]: rows(subject, {
				fields: [field("name", column(subject, "name"))],
				orderBy: [ascending(column(subject, "publicationRank"))],
				...(entityIds === undefined
					? {}
					: {
							where: inArray(
								column(subject, "id"),
								entityIds.map((id) => literal(id)),
							),
						}),
			}),
		}),
		settings: {
			pageSize: 24,
			addAction: null,
			tableColumns: null,
			defaultLayout: "grid",
			searchFields: ["name"],
			layouts: ["grid", "list"],
			sourceName: PUBLICATION_SOURCE,
			summary: { image: null, subtitle: null },
			subject: {
				entityAlias: PUBLICATION_SUBJECT_ALIAS,
				schemas: [reference(first), ...rest.map(reference)],
			},
		} satisfies EntityBrowserSavedViewSettings,
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
export const publicationItemDetailsRecipe = defineRecipe(
	(input: { readonly entityId: string; readonly fields: readonly BrowseValueField[] }) => {
		const subject = table("entity", BROWSE_SUBJECT_ALIAS);
		return {
			map: ({ item }) =>
				Result.succeed(
					item === undefined
						? []
						: input.fields.flatMap((browseField) => itemDetail(browseField, item[browseField.key])),
				),
			queries: {
				item: selectedOptionalRow(subject, {
					orderBy: [ascending(column(subject, "id"))],
					where: eq(column(subject, "id"), literal(input.entityId)),
					selection: Object.fromEntries(
						input.fields.map((browseField) => [
							browseField.key,
							selectedField(browseField.expression, DetailValue),
						]),
					),
				}),
			},
		};
	},
);

/** The other published items linked to this one, in either direction. */
export const publicationItemLinksRecipe = defineRecipe((input: { readonly entityId: string }) => {
	const link = table("relationship", "link");
	return {
		map: ({ links }) =>
			Result.succeed([
				...new Set(
					links.items.map(({ sourceEntityId, targetEntityId }) =>
						sourceEntityId === input.entityId ? targetEntityId : sourceEntityId,
					),
				),
			]),
		queries: {
			links: selectedRows(link, {
				limit: 100,
				orderBy: [ascending(column(link, "id"))],
				where: or(
					eq(column(link, "sourceEntityId"), literal(input.entityId)),
					eq(column(link, "targetEntityId"), literal(input.entityId)),
				),
				selection: {
					sourceEntityId: selectedField(column(link, "sourceEntityId"), Schema.String),
					targetEntityId: selectedField(column(link, "targetEntityId"), Schema.String),
				},
			}),
		},
	};
});
