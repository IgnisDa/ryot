import { definePlugin } from "@ryot-app/contract/modules/plugins/manifest";

import { manifest as greetManifest } from "./backend/greet.sandbox";

export const fixturePlugin = definePlugin({
	boot: [],
	crons: [],
	workflows: [],
	providers: [],
	savedViews: [],
	entitySchemas: [],
	signalSchemas: [],
	importSources: [],
	userBootstrap: [],
	httpRateLimits: [],
	relationshipSchemas: [],
	integrationProviders: [],
	configSchema: { fields: {}, unknownKeys: "strict" },
	scripts: [{ ...greetManifest, entry: "backend/greet.sandbox.ts" }],
	client: { entry: "client/index.tsx", apiVersion: 1 },
	operations: [
		{
			auth: "user",
			slug: "greet",
			scriptSlug: "operation.greet",
			description: "Return a deterministic greeting for the caller",
		},
	],
	bindings: {
		eventAutomations: [],
		entityAutomations: [],
		signalAutomations: [],
		relationshipAutomations: [],
		providerEntityImportAutomations: [],
	},
	metadata: {
		icon: "puzzle",
		slug: "fixture",
		name: "Fixture",
		version: "1.0.0",
		description: "A client plugin fixture used by the web client tracer.",
	},
});

export default fixturePlugin;
