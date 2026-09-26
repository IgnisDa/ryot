import type { ContractRequest } from "@ryot-app/contract/client";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { createRyotMutation, createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	pluginUserSettingsRecipe,
	type PluginUserSettingsPage,
} from "@ryot-app/ryotql-recipes/plugin-user-settings";
import { Effect } from "effect";

import { loadAllPages } from "#/api/load-all-pages";
import { PluginsApi } from "#/api/plugins";
import type { KernelRyotClient } from "#/api/ryot-client";
import type { KernelHostServices } from "#/host-services";

const PLUGIN_USER_SETTINGS_PAGE_SIZE = 100;

type PluginUserSetting = PluginUserSettingsPage["items"][number];
type SavePluginUserSettingsInput = {
	readonly installationId: string;
	readonly payload: ContractRequest<"plugins", "saveUserSettings">["payload"];
};

const loadPluginUserSettings = (client: Pick<KernelRyotClient, "data">) =>
	loadAllPages((after) =>
		client.data.query(pluginUserSettingsRecipe({ after, limit: PLUGIN_USER_SETTINGS_PAGE_SIZE })),
	).pipe(Effect.mapError(() => new RyotClientError("transport")));

export const pluginUserSettingsQuery = createRyotQuery<
	void,
	readonly PluginUserSetting[],
	KernelHostServices
>(({ client }) => loadPluginUserSettings(client));

export const pluginUserSettingQuery = createRyotQuery<
	{ readonly installationId: string },
	PluginUserSetting | undefined,
	KernelHostServices
>(({ input, client }) =>
	Effect.map(loadPluginUserSettings(client), (settings) =>
		settings.find((setting) => setting.id === input.installationId),
	),
);

export const savePluginUserSettingsMutation = createRyotMutation<
	SavePluginUserSettingsInput,
	void,
	KernelHostServices
>(({ input, client, hostServices }) =>
	hostServices.runtime
		.runSync(PluginsApi)
		.saveUserSettings(hostServices.scope, {
			payload: input.payload,
			params: { installationId: input.installationId },
		})
		.pipe(
			Effect.tap(() => Effect.sync(() => client.mutationCompleted.hint())),
			Effect.mapError(() => new RyotClientError("transport")),
		),
);

export const resetPluginUserSettingsMutation = createRyotMutation<string, void, KernelHostServices>(
	({ input, client, hostServices }) =>
		hostServices.runtime
			.runSync(PluginsApi)
			.resetUserSettings(hostServices.scope, { params: { installationId: input } })
			.pipe(
				Effect.tap(() => Effect.sync(() => client.mutationCompleted.hint())),
				Effect.mapError(() => new RyotClientError("transport")),
			),
);
