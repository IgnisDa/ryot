export default {
	boot: [],
	crons: [],
	workflows: [],
	providers: [],
	savedViews: [],
	operations: [],
	entitySchemas: [],
	signalSchemas: [],
	importSources: [],
	userBootstrap: [],
	relationshipSchemas: [],
	integrationProviders: [],
	configSchema: { unknownKeys: "strict", fields: {} },
	client: {
		apiVersion: 1,
		homeView: null,
		exports: {
			"home-summary": {
				kind: "component",
				entry: "client/home.tsx",
				automaticEntityPresentations: false,
			},
		},
	},
	httpRateLimits: [
		{ requests: 1, key: "test-api", intervalMs: 1000, origins: ["https://example.com/"] },
	],
	bindings: {
		eventAutomations: [],
		entityAutomations: [],
		signalAutomations: [],
		relationshipAutomations: [],
		providerEntityImportAutomations: [],
	},
	metadata: {
		icon: "test",
		slug: "cli-test",
		version: "1.0.0",
		name: "CLI test plugin",
		description: "A fixture for the CLI tests.",
	},
};
