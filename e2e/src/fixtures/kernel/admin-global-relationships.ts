import type { RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import { EntityId } from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	isNull,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

import type { HarnessTarget } from "~/support/harness-target";

import { collectAdminRyotQLRecipeItems } from "./ryotql";

const relationship = table("relationship", "relationship");

type GlobalRelationshipFilter =
	| { readonly type: "self"; readonly relationshipSchemaSlug: RelationshipSchemaSlug }
	| {
			readonly type: "anchored";
			readonly anchorEntityId: EntityId;
			readonly direction: "incoming" | "outgoing";
			readonly relationshipSchemaSlug: RelationshipSchemaSlug;
	  };

const adminGlobalRelationshipsRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			anchorEntityId: {
				type: "string",
				label: "Anchor",
				defaultValue: "",
				description: "Anchor entity",
			},
			relationshipSchemaSlug: {
				type: "string",
				label: "Schema",
				validation: { required: true },
				description: "Relationship schema",
			},
			type: {
				type: "enum",
				label: "Type",
				validation: { required: true },
				description: "Relationship shape",
				choices: { kind: "static", values: [{ value: "self" }, { value: "anchored" }] },
			},
			direction: {
				type: "enum",
				label: "Direction",
				defaultValue: "incoming",
				description: "Anchor direction",
				choices: { kind: "static", values: [{ value: "incoming" }, { value: "outgoing" }] },
			},
		},
	});
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ relationships }) => Result.succeed(relationships),
		queries: {
			relationships: selectedRows(relationship, {
				limit: 100,
				orderBy: [ascending(column(relationship, "id"))],
				selection: {
					properties: selectedField(column(relationship, "properties"), Schema.Unknown),
					sourceEntityId: selectedField(column(relationship, "sourceEntityId"), EntityId),
					targetEntityId: selectedField(column(relationship, "targetEntityId"), EntityId),
				},
				where: and(
					isNull(column(relationship, "userId")),
					eq(
						column(relationship, "relationshipSchemaSlug"),
						recipeParameters.value("relationshipSchemaSlug"),
					),
					recipeParameters.choice("type", {
						self: eq(
							column(relationship, "sourceEntityId"),
							column(relationship, "targetEntityId"),
						),
						anchored: recipeParameters.choice("direction", {
							outgoing: eq(
								column(relationship, "sourceEntityId"),
								recipeParameters.value("anchorEntityId"),
							),
							incoming: eq(
								column(relationship, "targetEntityId"),
								recipeParameters.value("anchorEntityId"),
							),
						}),
					}),
				),
			}),
		},
	});
})();

export const listAdminGlobalRelationships = (
	filter: GlobalRelationshipFilter,
	target?: HarnessTarget,
) =>
	collectAdminRyotQLRecipeItems(
		adminGlobalRelationshipsRecipe,
		{ ...filter },
		"relationships",
		target,
	);
