import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import type {
	FieldSelection,
	Include,
	OrderBy,
	ScalarExpression as ImportedScalarExpression,
} from "@ryot-app/contract/modules/ryotql/authored";
import {
	and,
	column,
	contains,
	document,
	entitySchemaPredicate,
	eq,
	exists,
	join,
	or,
	relationshipSchemaPredicate,
	rows,
	table,
} from "@ryot-app/ryotql";
import { librarySearchQuery } from "@ryot-app/ryotql-recipes/library-search";
import { filter, parameters, sort } from "@ryot-app/ryotql/authoring";

import {
	builtinMediaEntitySchemaSlugs,
	creatorGroupTargetSlugs,
} from "../shared/media-schema-slugs";

export const mediaSavedViewDataSources = (input: {
	readonly schema: string;
	readonly orderBy: readonly OrderBy[];
	readonly image: ImportedScalarExpression;
	readonly fields: readonly FieldSelection[];
	readonly reference: PluginIdentityReference;
	readonly include?: undefined | readonly [Include, ...Include[]];
	readonly subtitle?: {
		readonly expression: ImportedScalarExpression;
		readonly displayKind: "date" | "text" | "year" | "number" | "boolean";
	};
}) => {
	const entity = table("entity", "entity");
	const mediaLibrary = table("entity", "mediaLibrary");
	const membership = table("relationship", "inMediaLibrary");
	const savedMembership = exists(membership, {
		joins: [
			join(
				"inner",
				mediaLibrary,
				eq(column(membership, "targetEntityId"), column(mediaLibrary, "id")),
			),
		],
		where: and(
			eq(column(membership, "sourceEntityId"), column(entity, "id")),
			relationshipSchemaPredicate(membership, "in-media-library", input.reference),
			entitySchemaPredicate(mediaLibrary, "media-library", input.reference),
			eq(column(membership, "targetEntityId"), column(mediaLibrary, "id")),
		),
	});
	const credit = table("relationship", "personCredit");
	const target = table("entity", "personCreditTarget");
	const targetMembership = table("relationship", "personCreditMembership");
	const targetMediaLibrary = table("entity", "personCreditMediaLibrary");
	const creditTargets = [...builtinMediaEntitySchemaSlugs, ...creatorGroupTargetSlugs];
	const personCreditMembership =
		input.schema === "person"
			? exists(credit, {
					joins: [
						join("inner", target, eq(column(credit, "targetEntityId"), column(target, "id"))),
						join(
							"inner",
							targetMembership,
							eq(column(targetMembership, "sourceEntityId"), column(target, "id")),
						),
						join(
							"inner",
							targetMediaLibrary,
							eq(column(targetMembership, "targetEntityId"), column(targetMediaLibrary, "id")),
						),
					],
					where: and(
						eq(column(credit, "sourceEntityId"), column(entity, "id")),
						or(
							...creditTargets.map((slug) =>
								relationshipSchemaPredicate(credit, `person-to-${slug}`, input.reference),
							),
						),
						or(
							...creditTargets.map((slug) => entitySchemaPredicate(target, slug, input.reference)),
						),
						relationshipSchemaPredicate(targetMembership, "in-media-library", input.reference),
						entitySchemaPredicate(targetMediaLibrary, "media-library", input.reference),
					),
				})
			: undefined;
	const args = parameters({
		fields: {
			search: {
				type: "string",
				label: "Search",
				defaultValue: "",
				description: "Search library entries",
			},
		},
	});
	const base = rows(entity, {
		fields: input.fields,
		include: input.include,
		orderBy: input.orderBy,
		where: and(
			entitySchemaPredicate(entity, input.schema, input.reference),
			personCreditMembership === undefined
				? savedMembership
				: or(savedMembership, personCreditMembership),
		),
	});
	const browse = {
		alias: entity.alias,
		kind: "browse" as const,
		schemas: [{ slug: input.schema, owner: input.reference }] as const,
	};
	return {
		parameters: args.schema,
		controls: { sort: browse, filter: browse },
		...document({
			savedView: {
				...base,
				output: { ...base.output, orderBy: sort(input.orderBy) },
				where: and(
					base.where ?? and(),
					contains(column(entity, "name"), args.value("search")),
					filter(),
				),
			},
			librarySearch: librarySearchQuery({
				entity,
				source: base,
				image: input.image,
				search: args.value("search"),
				searchExpressions: [column(entity, "name")],
				...(input.subtitle ? { subtitle: input.subtitle } : {}),
			}).document,
		}),
	};
};
