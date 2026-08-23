import { describe, expect, it } from "@effect/vitest";
import { Effect, ManagedRuntime } from "effect";

import { AdminApi } from "#/api/admin";
import { decodeServerOrigin } from "#/api/origin";
import { ClientLive } from "#/boot/layers";
import { OAuthStorage } from "#/modules/auth/oauth-storage";
import { GodModeService } from "#/modules/god-mode/service";
import { GodModeSessionService } from "#/modules/god-mode/session";

const origin = decodeServerOrigin("https://ryot.example");

describe("Client layers", () => {
	it("builds the graph synchronously so the boot runSync cannot fail", () => {
		const runtime = ManagedRuntime.make(ClientLive);
		const tokenSet = runtime.runSync(
			Effect.flatMap(OAuthStorage, (storage) => storage.getTokenSet(origin)),
		);
		expect(tokenSet).toBeNull();
		expect(runtime.runSync(AdminApi)).toBeDefined();
		expect(runtime.runSync(GodModeService)).toBeDefined();
		expect(runtime.runSync(GodModeSessionService)).toBeDefined();
	});
});
