import { SandboxScriptMetadata } from "@ryot-app/contract/modules/scripts/schemas";
import { SandboxProviderId, SandboxScriptId } from "@ryot-app/contract/schema/brands";
import {
	ascending,
	column,
	defineRecipe,
	eq,
	type Recipe,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

import type { HarnessTarget } from "~/support/harness-target";

import { collectAdminRyotQLRecipeItems } from "./ryotql";

const script = table("sandboxScript", "script");

const adminSandboxScriptsRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			pluginRevisionId: {
				type: "string",
				label: "pluginRevisionId",
				description: "Query argument",
			},
		},
	});
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ scripts }) => Result.succeed(scripts),
		queries: {
			scripts: selectedRows(script, {
				limit: 100,
				orderBy: [ascending(column(script, "id"))],
				where: recipeParameters.whenSet(
					"pluginRevisionId",
					eq(column(script, "pluginRevisionId"), recipeParameters.value("pluginRevisionId")),
				),
				selection: {
					id: selectedField(column(script, "id"), SandboxScriptId),
					slug: selectedField(column(script, "slug"), Schema.String),
					name: selectedField(column(script, "name"), Schema.String),
					contentHash: selectedField(column(script, "contentHash"), Schema.String),
					metadata: selectedField(column(script, "metadata"), SandboxScriptMetadata),
					compiledFormat: selectedField(column(script, "compiledFormat"), Schema.Int),
					providerId: selectedField(column(script, "providerId"), Schema.NullOr(SandboxProviderId)),
					pluginRevisionId: selectedField(
						column(script, "pluginRevisionId"),
						Schema.NullOr(Schema.String),
					),
				},
			}),
		},
	});
})();

export type AdminSandboxScript = Recipe.Success<typeof adminSandboxScriptsRecipe>["items"][number];

export const listAdminSandboxScripts = (pluginRevisionId?: string, target?: HarnessTarget) =>
	collectAdminRyotQLRecipeItems(adminSandboxScriptsRecipe, { pluginRevisionId }, "scripts", target);
