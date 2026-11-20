import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";

import { scanMediaServer } from "../inventory/media-server";
import { IntegrationWindowOutput, YankInput } from "../schemas";

export const manifest = defineManifest({
	kind: "script",
	name: "emby inventory yank",
	slug: "integration.emby-inventory",
});

export default defineScript({
	manifest,
	input: YankInput,
	output: IntegrationWindowOutput,
	run: (input, host) => scanMediaServer("emby", input, host),
});
