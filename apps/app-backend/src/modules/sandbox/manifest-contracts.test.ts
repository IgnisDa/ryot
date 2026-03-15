import { expect, it } from "@effect/vitest";
import { SandboxScriptManifest } from "@ryot/contract/modules/sandbox/schemas";
import { sandboxManifestSchema, type SandboxManifest } from "@ryot/sandbox-sdk/core";
import { Schema as SandboxSchema } from "@ryot/sandbox-sdk/effect";
import { Effect, Schema } from "effect";

const manifests = [
	{
		kind: "script",
		name: "Script",
		slug: "script",
		capabilities: ["getCachedValue", "getSystemConfig"],
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: ["timezone"],
	},
	{
		capabilities: [],
		kind: "automation",
		name: "Automation",
		slug: "automation.test",
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
	},
	{
		kind: "provider",
		name: "Provider",
		slug: "provider.test",
		capabilities: ["httpCall", "getSystemConfig"],
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: ["videoGames.testApiKey"],
	},
] satisfies SandboxManifest[];

const decodeManifest = Schema.decodeUnknownEffect(SandboxScriptManifest);
const decodeSdkManifest = SandboxSchema.decodeUnknownEffect(sandboxManifestSchema);

it.effect("keeps Effect manifest decoding in parity with representative SDK manifests", () =>
	Effect.gen(function* () {
		for (const manifest of manifests) {
			const sdkManifest = yield* decodeSdkManifest(manifest);

			expect(yield* decodeManifest(manifest)).toEqual(sdkManifest);
		}
	}),
);
