import type { ContractPayload } from "@ryot/contract/client";
import { Effect } from "effect";

import { installTestPluginBundle } from "./test-plugin";

type PluginManifest = ContractPayload<"plugins", "install">["manifest"];

export const installTestIntegrationProvider = (
	settingsSchema: PluginManifest["integrationProviders"][number]["settingsSchema"],
	options: { baseUrl?: string; requiresProKey?: boolean } = {},
) => {
	const suffix = crypto.randomUUID();
	const pluginSlug = `e2e-integration-plugin-${suffix}`;
	const providerSlug = `e2e-integration-provider-${suffix}`;
	const scriptSlug = `integration.e2e-sink-${suffix}`;
	const entry = `scripts/${scriptSlug}.sandbox.ts`;
	const name = "E2E integration sink";
	const source = `
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: ${JSON.stringify(name)},
  slug: ${JSON.stringify(scriptSlug)},
});

export default defineScript({
  manifest,
  input: Schema.Unknown,
  output: Schema.Unknown,
  run: () => Effect.succeed(null),
});
`;

	return installTestPluginBundle({
		pluginSlug,
		baseUrl: options.baseUrl,
		files: { [entry]: source },
		scripts: [
			{
				name,
				entry,
				kind: "script",
				slug: scriptSlug,
				capabilities: [],
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
			},
		],
		integrationProviders: [
			{
				scriptSlug,
				lot: "sink",
				settingsSchema,
				slug: providerSlug,
				name: "E2E integration provider",
				description: "E2E dynamically installed integration provider",
				...(options.requiresProKey !== undefined ? { requiresProKey: options.requiresProKey } : {}),
			},
		],
	}).pipe(Effect.map((plugin) => ({ plugin, providerSlug })));
};
