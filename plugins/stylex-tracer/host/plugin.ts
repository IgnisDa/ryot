import { definePlugin } from "@ryot-app/contract/modules/plugins/manifest";

export const stylexTracerPlugin = definePlugin({
	boot: [],
	crons: [],
	providers: [],
	workflows: [],
	operations: [],
	savedViews: [],
	entitySchemas: [],
	signalSchemas: [],
	importSources: [],
	userBootstrap: [],
	httpRateLimits: [],
	relationshipSchemas: [],
	integrationProviders: [],
	configSchema: { fields: {}, unknownKeys: "strict" },
	bindings: {
		eventAutomations: [],
		entityAutomations: [],
		signalAutomations: [],
		relationshipAutomations: [],
		providerEntityImportAutomations: [],
	},
	metadata: {
		version: "0.0.1",
		icon: "flask-conical",
		slug: "stylex-tracer",
		name: "StyleX tracer",
		description: "An opt-in StyleX client compilation experiment.",
	},
	client: {
		entities: {},
		apiVersion: 1,
		homeView: null,
		routes: { "/": "stylex-tracer-page" },
		exports: {
			"stylex-tracer-page": {
				kind: "page",
				entry: "client/page.tsx",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
			},
		},
	},
});

export default stylexTracerPlugin;
