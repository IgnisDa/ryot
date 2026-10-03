import { describe, expect, it } from "@effect/vitest";
import { Effect, ManagedRuntime } from "effect";

import { GodModeApi } from "#/api/god-mode";
import { decodeServerOrigin } from "#/api/origin";
import { ClientLive } from "#/boot/layers";
import { OAuthStorage } from "#/modules/auth/oauth-storage";
import { GodModeImpersonationService } from "#/modules/god-mode/impersonation";
import { GodModeService } from "#/modules/god-mode/service";
import { GodModeSessionService } from "#/modules/god-mode/session";
import { OAuthConnectService } from "#/modules/integrations/oauth-connect";
import { OAuthReturnCapture } from "#/modules/integrations/oauth-return";
import { DeepLinkClaims } from "#/modules/navigation/deep-link";

const origin = decodeServerOrigin("https://ryot.example");

describe("Client layers", () => {
	it("builds the graph synchronously so the boot runSync cannot fail", () => {
		const runtime = ManagedRuntime.make(ClientLive);
		const tokenSet = runtime.runSync(
			Effect.flatMap(OAuthStorage, (storage) => storage.getTokenSet(origin)),
		);
		expect(tokenSet).toBeNull();
		expect(runtime.runSync(GodModeApi)).toBeDefined();
		expect(runtime.runSync(GodModeService)).toBeDefined();
		expect(runtime.runSync(GodModeImpersonationService)).toBeDefined();
		expect(runtime.runSync(GodModeSessionService)).toBeDefined();
		expect(runtime.runSync(OAuthConnectService)).toBeDefined();
		expect(runtime.runSync(OAuthReturnCapture)).toBeDefined();
		expect(runtime.runSync(DeepLinkClaims)).toBeDefined();
	});
});
