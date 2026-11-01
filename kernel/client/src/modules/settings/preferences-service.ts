import type {
	UserPreferences,
	UserPreferencesPatch,
} from "@ryot-app/contract/schema/user-preferences";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { createRyotHostMutation, createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { userSettingsRecipe } from "@ryot-app/ryotql-recipes/user-settings";
import { Effect } from "effect";

import { AccountApi } from "#/api/account";
import { KernelHostServices } from "#/host-services";
import { EntityWatchService } from "#/modules/entity-watches/service";

export const preferencesQuery = createRyotQuery<void, UserPreferences>(({ client }) =>
	Effect.map(client.data.query(userSettingsRecipe()), (settings) => settings.preferences),
);

export const updatePreferencesMutation = createRyotHostMutation<
	UserPreferencesPatch,
	void,
	KernelHostServices
>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(AccountApi)
			.updatePreferences(hostServices.scope, { payload: input })
			.pipe(
				Effect.tap(() =>
					input.language === undefined
						? Effect.void
						: Effect.sync(() =>
								hostServices.runtime.runSync(EntityWatchService).reconnect(hostServices.scope),
							),
				),
				Effect.tap(() => Effect.sync(() => client.mutationCompleted.hint())),
				Effect.mapError(() => new RyotClientError({ reason: "transport" })),
			),
	{ hostServices: KernelHostServices },
);
