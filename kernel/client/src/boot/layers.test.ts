import { describe, expect, it } from "@effect/vitest";
import { Effect, ManagedRuntime } from "effect";

import { ClientLive } from "#/boot/layers";
import { OAuthStorage } from "#/modules/auth/oauth-storage";

describe("Client layers", () => {
	it("builds the graph synchronously so the boot runSync cannot fail", () => {
		const runtime = ManagedRuntime.make(ClientLive);
		const tokenSet = runtime.runSync(
			Effect.flatMap(OAuthStorage, (storage) => storage.getTokenSet("https://ryot.example")),
		);
		expect(tokenSet).toBeNull();
	});
});
