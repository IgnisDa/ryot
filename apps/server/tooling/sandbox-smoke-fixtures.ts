import { SandboxScriptManifest } from "@ryot-app/contract/modules/sandbox/schemas";
import { CompilerWorkerResponse } from "@ryot-app/sandbox-compiler/protocol";
import { Schema } from "effect";

export const smokeSourceManifest = {
	kind: "script",
	name: "Production runtime smoke",
	slug: "production-runtime-smoke",
} as const;

export const smokeHostCallKey = "production-smoke";
export const smokeHostCallValue = "mediated-production-smoke";
export const smokeTiers = ["core", "data", "full"] as const;

const CompiledSmokeDefinition = Schema.Struct({
	...CompilerWorkerResponse.members[0].fields.value.fields,
	manifest: Schema.Struct({
		...SandboxScriptManifest.members[0].fields,
		name: Schema.Literal(smokeSourceManifest.name),
		slug: Schema.Literal(smokeSourceManifest.slug),
		capabilities: Schema.Array(Schema.String).pipe(
			Schema.check(
				Schema.makeFilter(
					(capabilities) =>
						capabilities.includes("getCachedValue") ||
						"Smoke fixtures must declare the getCachedValue capability",
				),
			),
		),
	}),
});

export const SandboxSmokeFixturesJson = Schema.fromJsonString(
	Schema.Struct({
		core: CompiledSmokeDefinition,
		data: CompiledSmokeDefinition,
		full: CompiledSmokeDefinition,
	}),
);
