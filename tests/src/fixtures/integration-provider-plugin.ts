import type { PluginManifest } from "@ryot/plugin-kit/manifest";
import { Effect } from "effect";

import { installTestPluginBundle } from "./test-plugin";

export const installTestIntegrationProvider = (
	settingsSchema: PluginManifest["integrationProviders"][number]["settingsSchema"],
) => {
	const suffix = crypto.randomUUID();
	const pluginSlug = `e2e-integration-plugin-${suffix}`;
	const providerSlug = `e2e-integration-provider-${suffix}`;
	const scriptSlug = `integration.e2e-sink-${suffix}`;
	const entry = `scripts/${scriptSlug}.sandbox.ts`;
	const name = "E2E integration sink";
	const source = `
import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "activity",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: ${JSON.stringify(name)},
  slug: ${JSON.stringify(scriptSlug)},
});

export default defineActivity({
  manifest,
  input: Schema.Unknown,
  output: Schema.Unknown,
  run: () => Effect.succeed(null),
});
`;

	return installTestPluginBundle({
		pluginSlug,
		files: { [entry]: source },
		scripts: [
			{
				name,
				entry,
				slug: scriptSlug,
				kind: "activity",
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
			},
		],
	}).pipe(Effect.map((plugin) => ({ plugin, providerSlug })));
};
