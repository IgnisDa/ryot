import { definePlugin } from "@ryot/contract/modules/plugins/manifest";

export const fixturePlugin = definePlugin({
	boot: [],
	crons: [],
	scripts: [],
	workflows: [],
	providers: [],
	savedViews: [],
	operations: [],
	entitySchemas: [],
	signalSchemas: [],
	importSources: [],
	userBootstrap: [],
	httpRateLimits: [],
	relationshipSchemas: [],
	integrationProviders: [],
	configSchema: { fields: {}, unknownKeys: "strict" },
	client: { entry: "client/index.tsx", apiVersion: 1, capabilities: [] },
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
