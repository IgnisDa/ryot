import type {
	UserPreferences,
	UserPreferencesPatch,
} from "@ryot-app/contract/schema/user-preferences";
import { createRyotHostMutation, createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { userSettingsRecipe } from "@ryot-app/ryotql-recipes/user-settings";
import { Effect } from "effect";

import { AccountApi } from "#/api/account";
import type { AuthenticatedApiError } from "#/api/authenticated";
import { KernelHostServices } from "#/host-services";
import { EntityWatchService } from "#/modules/entity-watches/service";

export const preferencesQuery = createRyotQuery<void, UserPreferences>(({ client }) =>
	Effect.map(client.data.query(userSettingsRecipe, {}), (settings) => settings.preferences),
);

export const initializeInterfaceLocaleMutation = createRyotHostMutation<
	string,
	void,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ hostServices, input: locale }) =>
		hostServices.runtime
			.runSync(AccountApi)
			.initializeInterfaceLocale(hostServices.scope, { payload: { locale } }),
	{ hostServices: KernelHostServices },
);

export const updatePreferencesMutation = createRyotHostMutation<
	UserPreferencesPatch,
	void,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(AccountApi)
			.updatePreferences(hostServices.scope, { payload: input })
			.pipe(
				Effect.tap(() =>
					input.contentLanguage === undefined
						? Effect.void
						: Effect.sync(() =>
								hostServices.runtime.runSync(EntityWatchService).reconnect(hostServices.scope),
							),
				),
				Effect.tap(() => Effect.sync(() => client.mutationCompleted.hint())),
			),
	{ hostServices: KernelHostServices },
);
