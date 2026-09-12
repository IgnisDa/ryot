import type { RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import { EntityId } from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	isNull,
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import { collectAdminRyotQLRecipeItems } from "./ryotql";

const relationship = table("relationship", "relationship");

type GlobalRelationshipFilter =
	| { readonly type: "self"; readonly relationshipSchemaSlug: RelationshipSchemaSlug }
	| {
			readonly type: "anchored";
			readonly direction: "incoming" | "outgoing";
			readonly anchorEntityId: EntityId;
			readonly relationshipSchemaSlug: RelationshipSchemaSlug;
	  };

const adminGlobalRelationshipsRecipe = defineRecipe(
	(input: GlobalRelationshipFilter & { readonly after?: string }) => ({
		map: ({ relationships }) => Result.succeed(relationships),
		queries: {
			relationships: selectedRows(relationship, {
				limit: 100,
				after: input.after,
				orderBy: [ascending(column(relationship, "id"))],
				selection: {
					properties: selectedField(column(relationship, "properties"), Schema.Unknown),
					sourceEntityId: selectedField(column(relationship, "sourceEntityId"), EntityId),
					targetEntityId: selectedField(column(relationship, "targetEntityId"), EntityId),
				},
				where: and(
					isNull(column(relationship, "userId")),
					eq(column(relationship, "relationshipSchemaSlug"), literal(input.relationshipSchemaSlug)),
					input.type === "self"
						? eq(column(relationship, "sourceEntityId"), column(relationship, "targetEntityId"))
						: eq(
								column(
									relationship,
									input.direction === "outgoing" ? "sourceEntityId" : "targetEntityId",
								),
								literal(input.anchorEntityId),
							),
				),
			}),
		},
	}),
);

export const listAdminGlobalRelationships = (filter: GlobalRelationshipFilter) =>
	collectAdminRyotQLRecipeItems((after) => adminGlobalRelationshipsRecipe({ ...filter, after }));
