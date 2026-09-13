import { RyotClientError } from "@ryot-app/client-sdk";
import { createRyotMutation, createRyotQuery } from "@ryot-app/client-sdk/react";
import type { UpdateUserPreferencesBody } from "@ryot-app/contract/modules/user-settings/schemas";
import type { UserPreferences } from "@ryot-app/contract/schema/user-preferences";
import { userSettingsRecipe } from "@ryot-app/ryotql-recipes/user-settings";
import { Effect } from "effect";

import { UserSettingsApi } from "#/api/user-settings";
import type { KernelHostServices } from "#/host-services";
import { EntityInterestService } from "#/modules/entity-interest/service";

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
		.runSync(UserSettingsApi)
		.updatePreferences(hostServices.scope, { payload: input })
		.pipe(
			Effect.tap(() =>
				input.language === undefined
					? Effect.void
					: Effect.sync(() =>
							hostServices.runtime.runSync(EntityInterestService).reconnect(hostServices.scope),
						),
			),
			Effect.tap(() => Effect.sync(() => client.mutationCompleted.hint())),
			Effect.mapError(() => new RyotClientError("transport")),
		),
);
