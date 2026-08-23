import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: [],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Fixture Provider Search",
	slug: "fixture.provider.search",
	searchOptionsSchema: {
		unknownKeys: "strict",
		fields: {
			passRawQuery: {
				type: "boolean",
				label: "Pass raw query",
				description: "Pass the query without modification",
			},
		},
	},
});

export default defineProvider({ manifest, operation: "search", run: () => Effect.die("unused") });
