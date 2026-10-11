export default {
	crons: [],
	hooks: [],
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
	configSchema: { fields: {}, unknownKeys: "strict" },
	httpRateLimits: [
		{ requests: 1, key: "test-api", intervalMs: 1000, origins: ["https://example.com/"] },
	],
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
	metadata: {
		icon: "test",
		slug: "cli-test",
		version: "1.0.0",
		name: "CLI test plugin",
		description: "A fixture for the CLI tests.",
		packageId: "ee8040dd-5a40-42a1-916d-58190c1a06e8",
	},
};
