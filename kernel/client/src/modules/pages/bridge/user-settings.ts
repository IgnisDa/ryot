import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import { isJsonValue, type JsonValue } from "@ryot-app/contract/schema/json";
import type {
	PluginReportingPreferencesOutcome,
	PluginUserSettingsOutcome,
	PluginUserSettingsRequest,
} from "@ryot-app/plugin-client-contract";
import { initialSchemaFormValues } from "@ryot-app/plugin-ui-sdk/schema-form";
import { pluginInstallationUserSettingsRecipe } from "@ryot-app/ryotql-recipes/plugin-user-settings";
import { userSettingsRecipe } from "@ryot-app/ryotql-recipes/user-settings";
import { Effect, Result } from "effect";

import type { RyotQLApi } from "#/api/ryotql";
import { type ApiScope, apiScopeKey } from "#/api/scope";

import { hasPluginContributor, invalidRequest } from "./plugin-contributor";

const transport = { outcome: "failure", reason: "transport" } as const;

const isCurrentScope = (scope: ApiScope, currentScope: () => ApiScope | undefined) => {
	const current = currentScope();
	return current !== undefined && apiScopeKey(current) === apiScopeKey(scope);
};

export const reportingPreferencesOutcome = (input: {
	readonly scope: ApiScope;
	readonly currentScope: () => ApiScope | undefined;
	readonly api: Pick<RyotQLApi["Service"], "execute">;
}): Effect.Effect<PluginReportingPreferencesOutcome> =>
	Effect.gen(function* () {
		if (!isCurrentScope(input.scope, input.currentScope)) {
			return invalidRequest;
		}
		const recipe = userSettingsRecipe();
		const response = yield* Effect.result(
			input.api.execute(input.scope, { payload: recipe.document }),
		);
		if (!isCurrentScope(input.scope, input.currentScope)) {
			return invalidRequest;
		}
		if (Result.isFailure(response)) {
			return transport;
		}
		const decoded = recipe.decode(response.success);
		if (Result.isFailure(decoded)) {
			return transport;
		}
		return {
			outcome: "success",
			preferences: { timeZone: decoded.success.preferences.reportingTimeZone },
		} as const;
	});

export const pluginUserSettingsOutcome = (input: {
	readonly scope: ApiScope;
	readonly request: PluginUserSettingsRequest;
	readonly currentScope: () => ApiScope | undefined;
	readonly api: Pick<RyotQLApi["Service"], "execute">;
	readonly contributors: PreparedClientPage["identity"]["contributors"];
}): Effect.Effect<PluginUserSettingsOutcome> =>
	Effect.gen(function* () {
		const isCurrent = () => isCurrentScope(input.scope, input.currentScope);
		if (!isCurrent()) {
			return invalidRequest;
		}
		if (!hasPluginContributor(input.contributors, input.request.pluginId)) {
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
