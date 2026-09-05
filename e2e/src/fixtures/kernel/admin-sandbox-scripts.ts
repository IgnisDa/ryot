import { SandboxScriptMetadata } from "@ryot-app/contract/modules/sandbox/schemas";
import { SandboxProviderId, SandboxScriptId } from "@ryot-app/contract/schema/brands";
import {
	ascending,
	column,
	defineRecipe,
	eq,
	literal,
	selectedField,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import { collectAdminRyotQLRecipeItems } from "./ryotql";

const script = table("sandboxScript", "script");

const adminSandboxScriptsRecipe = defineRecipe(
	(input: { readonly after?: string; readonly pluginRevisionId?: string }) => ({
		map: ({ scripts }) => Result.succeed(scripts),
		queries: {
			scripts: selectedRows(script, {
				limit: 100,
				after: input.after,
				orderBy: [ascending(column(script, "id"))],
				where:
					input.pluginRevisionId === undefined
						? undefined
						: eq(column(script, "pluginRevisionId"), literal(input.pluginRevisionId)),
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
	}),
);

export type AdminSandboxScript = Recipe.Success<typeof adminSandboxScriptsRecipe>["items"][number];

export const listAdminSandboxScripts = (pluginRevisionId?: string, baseUrl?: string) =>
	collectAdminRyotQLRecipeItems(
		(after) => adminSandboxScriptsRecipe({ after, pluginRevisionId }),
		baseUrl,
	);
