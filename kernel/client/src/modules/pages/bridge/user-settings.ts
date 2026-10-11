import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import { isJsonValue, type JsonValue } from "@ryot-app/contract/schema/json";
import type {
	PluginUserSettingsOutcome,
	PluginUserSettingsRequest,
} from "@ryot-app/plugin-client-contract";
import { initialSchemaFormValues } from "@ryot-app/plugin-ui-sdk/schema-form";
import { pluginInstallationUserSettingsRecipe } from "@ryot-app/ryotql-recipes/plugin-user-settings";
import { Effect, Result } from "effect";

import type { RyotQLApi } from "#/api/ryotql";
import { type ApiScope, apiScopeKey } from "#/api/scope";

import { hasPluginContributor, invalidRequest } from "./plugin-contributor";

const transport = { outcome: "failure", reason: "transport" } as const;

export const pluginUserSettingsOutcome = (input: {
	readonly scope: ApiScope;
	readonly api: Pick<RyotQLApi["Service"], "execute">;
	readonly currentScope: () => ApiScope | undefined;
	readonly request: PluginUserSettingsRequest;
	readonly contributors: PreparedClientPage["identity"]["contributors"];
}): Effect.Effect<PluginUserSettingsOutcome> =>
	Effect.gen(function* () {
		const isCurrent = () => {
			const current = input.currentScope();
			return current !== undefined && apiScopeKey(current) === apiScopeKey(input.scope);
		};
		if (!isCurrent() || !hasPluginContributor(input.contributors, input.request.pluginId)) {
			return invalidRequest;
		}
		const recipe = pluginInstallationUserSettingsRecipe({ pluginId: input.request.pluginId });
		const response = yield* Effect.result(
			input.api.execute(input.scope, { payload: recipe.document }),
		);
		if (!isCurrent()) {
			return invalidRequest;
		}
		if (Result.isFailure(response)) {
			return transport;
		}
		const decoded = recipe.decode(response.success);
		if (Result.isFailure(decoded)) {
			return transport;
		}
		const row = decoded.success;
		if (!row?.settingsSchema) {
			return { settings: {}, outcome: "success" } as const;
		}
		const settings: Record<string, JsonValue> = Object.fromEntries(
			Object.entries(initialSchemaFormValues(row.settingsSchema, undefined, row.settings)).filter(
				(entry): entry is [string, JsonValue] => isJsonValue(entry[1]),
			),
		);
		return { settings, outcome: "success" } as const;
	});
