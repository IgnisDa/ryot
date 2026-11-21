import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { scanMediaServer } from "../inventory/media-server";
import { IntegrationWindowOutput, YankInput } from "../schemas";

export const manifest = defineManifest({
	kind: "script",
	name: "jellyfin inventory yank",
	slug: "integration.jellyfin-inventory",
});

export default defineActivity({
	manifest,
	input: YankInput,
	output: IntegrationWindowOutput,
	run: (input, host) => scanMediaServer("jellyfin", input, host),
});
