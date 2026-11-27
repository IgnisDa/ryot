import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

export const manifest = defineManifest({
	kind: "provider",
	name: "Fixture Provider Details",
	slug: "fixture.provider.details",
});

export default defineProvider({ manifest, operation: "details", run: () => Effect.die("unused") });
