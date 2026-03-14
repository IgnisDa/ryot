import { expect, it } from "@effect/vitest";
import { SandboxScriptManifest } from "@ryot/contract/modules/sandbox/schemas";
import { sandboxManifestSchema, type SandboxManifest } from "@ryot/sandbox-sdk";
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
		requiredAppConfigKeys: ["providers.testApiKey"],
		providerInformation: { source: "Test", canonicalLanguage: "en" },
	},
	{
		kind: "trigger",
		mode: "before_create",
		name: "Before trigger",
		slug: "trigger.before",
		requiredAppConfigKeys: [],
		capabilities: ["getEntity"],
	},
	{
		kind: "trigger",
		mode: "after_create",
		name: "After trigger",
		slug: "trigger.after",
		requiredAppConfigKeys: [],
		capabilities: ["createEvents"],
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
