import { expect, it } from "@effect/vitest";
import { SandboxScriptManifest } from "@ryot-app/contract/modules/sandbox/schemas";
import { sandboxManifestSchema, type SandboxManifest } from "@ryot-app/sandbox-sdk/core";
import { Schema as SandboxSchema } from "@ryot-app/sandbox-sdk/effect";
import { Effect, Schema } from "effect";

const manifests = [
	{
		kind: "script",
		name: "Script",
		slug: "script",
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: ["timezone"],
		capabilities: ["getCachedValue", "getSystemConfig"],
	},
	{
		capabilities: [],
		kind: "automation",
		name: "Automation",
		slug: "automation.test",
		automationType: "automation",
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
		inputProjection: { signal: { properties: [] } },
	},
	{
		kind: "provider",
		name: "Provider",
		slug: "provider.test",
		requiredPluginConfigKeys: [],
		capabilities: ["httpCall", "getSystemConfig"],
		requiredSystemConfigKeys: ["videoGames.testApiKey"],
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
	},
] satisfies SandboxManifest[];

const decodeManifest = Schema.decodeUnknownEffect(SandboxScriptManifest);
const decodeSdkManifest = SandboxSchema.decodeUnknownEffect(sandboxManifestSchema);

it.effect("keeps Effect manifest decoding in parity with representative SDK manifests", () =>
	Effect.gen(function* () {
		for (const manifest of manifests) {
			const sdkManifest = yield* decodeSdkManifest(manifest);
			const effectManifest = yield* decodeManifest(manifest);

			expect(effectManifest).toEqual(sdkManifest);
		}
	}),
);
