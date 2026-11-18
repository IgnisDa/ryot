import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

const eventScope = table("eventScope", "entityEventScope");

/** The revision a change set's `events.baselines` names for the entity, zero while its scope has no row. */
export const entityEventScopeRevisionRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			entityId: {
				type: "string",
				validation: { required: true },
				description: "Entity Id for this selection",
				label: kernelMessage("recipe.parameter.entity"),
			},
		},
	});
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ scope }) => Result.succeed(scope?.revision ?? 0),
		queries: {
			scope: selectedOptionalRow(eventScope, {
				orderBy: [ascending(column(eventScope, "id"))],
				selection: { revision: selectedField(column(eventScope, "revision"), Schema.Int) },
				where: and(
					schemaOwnerPredicate(eventScope, "eventSchemaPluginId", { kind: "self" }),
					eq(column(eventScope, "entityId"), recipeParameters.value("entityId")),
				),
			}),
		},
	});
})();
