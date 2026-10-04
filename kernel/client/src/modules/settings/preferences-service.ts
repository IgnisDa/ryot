import type { UpdateUserPreferencesBody } from "@ryot-app/contract/modules/account/schemas";
import type { UserPreferences } from "@ryot-app/contract/schema/user-preferences";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { createRyotMutation, createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { userSettingsRecipe } from "@ryot-app/ryotql-recipes/user-settings";
import { Effect } from "effect";

import { AccountApi } from "#/api/account";
import type { KernelHostServices } from "#/host-services";
import { EntityWatchService } from "#/modules/entity-watches/service";

export const preferencesQuery = createRyotQuery<void, UserPreferences, KernelHostServices>(
	({ client }) =>
		Effect.map(client.data.query(userSettingsRecipe()), (settings) => settings.preferences),
);

export const updatePreferencesMutation = createRyotMutation<
	UpdateUserPreferencesBody,
	void,
	KernelHostServices
>(({ input, client, hostServices }) =>
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
			Effect.mapError(() => new RyotClientError("transport")),
		),
);
