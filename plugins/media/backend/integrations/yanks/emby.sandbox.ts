import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import { scanMediaServer } from "../inventory/media-server";
import { IntegrationWindowOutput, YankInput } from "../schemas";

export const manifest = defineManifest({
	kind: "script",
	name: "emby inventory yank",
	slug: "integration.emby-inventory",
});

export default defineActivity({
	manifest,
	input: YankInput,
	output: IntegrationWindowOutput,
	run: (input, host) =>
		scanMediaServer("emby", input, host).pipe(Effect.map((output) => ({ output }))),
});
