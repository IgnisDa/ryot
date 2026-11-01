import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import type { FieldSelection, Include, OrderBy } from "@ryot-app/contract/modules/ryotql/language";
import {
	and,
	column,
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

import {
	builtinMediaEntitySchemaSlugs,
	creatorGroupTargetSlugs,
} from "../shared/media-schema-slugs";

export const mediaSavedViewDataSources = (input: {
	readonly schema: string;
	readonly orderBy: readonly OrderBy[];
	readonly fields: readonly FieldSelection[];
	readonly reference: PluginIdentityReference;
	readonly include?: undefined | readonly [Include, ...Include[]];
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

	return document({
		savedView: rows(entity, {
			fields: input.fields,
			include: input.include,
			orderBy: input.orderBy,
			where: and(
				entitySchemaPredicate(entity, input.schema, input.reference),
				personCreditMembership === undefined
					? savedMembership
					: or(savedMembership, personCreditMembership),
			),
		}),
	});
};
