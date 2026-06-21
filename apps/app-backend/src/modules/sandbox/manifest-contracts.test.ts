import { expect, it } from "@effect/vitest";
import { SandboxScriptManifest } from "@ryot/contract/modules/sandbox/schemas";
import { sandboxManifestSchema, type SandboxManifest } from "@ryot/sandbox-sdk/core";
import { Effect, Schema } from "effect";

const manifests = [
	{
		kind: "script",
		name: "Script",
		slug: "script",
		capabilities: ["getCachedValue"],
		requiredAppConfigKeys: ["timezone"],
	},
	{
		capabilities: [],
		kind: "automation",
		name: "Automation",
		slug: "automation.test",
		requiredAppConfigKeys: [],
	},
	{
		kind: "provider",
		name: "Provider",
		slug: "provider.test",
		capabilities: ["httpCall"],
		requiredAppConfigKeys: ["videoGames.testApiKey"],
		providerInformation: { source: "Test", canonicalLanguage: "en" },
	},
] satisfies SandboxManifest[];

const decodeManifest = Schema.decodeUnknown(SandboxScriptManifest);

it.effect("keeps Effect manifest decoding in parity with representative SDK manifests", () =>
	Effect.gen(function* () {
		for (const manifest of manifests) {
			const sdkManifest = sandboxManifestSchema.parse(manifest);

			expect(yield* decodeManifest(manifest)).toEqual(sdkManifest);
		}
	}),
);
