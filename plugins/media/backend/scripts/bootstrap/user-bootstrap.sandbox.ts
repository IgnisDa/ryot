import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
	kind: "script",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "bootstrap.media-workspace",
	name: "Initialize Media Workspace",
	capabilities: ["ensureUserEntities"],
});

export default defineScript({
	manifest,
	input: Schema.Struct({}),
	output: Schema.Struct({
		results: Schema.Array(Schema.Struct({ entityId: Schema.String, wasInserted: Schema.Boolean })),
	}),
	run: (_input, host) =>
		host
			.ensureUserEntities([{ properties: {}, name: "Library", entitySchemaSlug: "library" }])
			.pipe(Effect.map((results) => ({ results }))),
});
