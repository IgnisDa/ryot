import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
	kind: "script",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "bootstrap.fitness-workspace",
	name: "Initialize Fitness Workspace",
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
			.ensureUserEntities([
				{ properties: {}, name: "Fitness Library", entitySchemaSlug: "fitness-library" },
			])
			.pipe(Effect.map((results) => ({ results }))),
});
