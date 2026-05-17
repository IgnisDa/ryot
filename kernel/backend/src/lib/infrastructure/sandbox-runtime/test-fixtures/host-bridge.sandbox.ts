import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
	kind: "script",
	name: "Host bridge fixture",
	slug: "host-bridge-fixture",
	requiredSystemConfigKeys: [],
	requiredPluginConfigKeys: ["fixtureValue"],
	capabilities: ["getCachedValue", "getPluginConfig", "httpCall", "setCachedValue"],
});

export default defineScript({
	manifest,
	output: Schema.Unknown,
	input: Schema.Struct({}),
	run: (_input, host) =>
		Effect.gen(function* () {
			const config = yield* host.getPluginConfig(["fixtureValue"]);
			const cached = yield* host.getCachedValue("fixture-key");
			yield* host.setCachedValue("fixture-key", { ready: true }, 60);
			const response = yield* host.httpCall("GET", "https://example.com/fixture");
			return { cached, config, response };
		}),
});
