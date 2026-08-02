import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: [],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Fixture Provider Details",
	slug: "fixture.provider.details",
});

export default defineProvider({
	manifest,
	operation: "details",
	run: () => Effect.die("unused"),
});
