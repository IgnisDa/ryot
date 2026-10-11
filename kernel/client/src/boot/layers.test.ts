import { describe, expect, it } from "@effect/vitest";
import { Effect, ManagedRuntime } from "effect";

import { InstanceAdminApi } from "#/api/instance-admin";
import { decodeServerOrigin } from "#/api/origin";
import { ClientLive } from "#/boot/layers";
import { OAuthStorage } from "#/modules/auth/oauth-storage";
import { InstanceAdminImpersonationService } from "#/modules/instance-admin/impersonation";
import { InstanceAdminService } from "#/modules/instance-admin/service";
import { InstanceAdminSessionService } from "#/modules/instance-admin/session";
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
		expect(runtime.runSync(InstanceAdminApi)).toBeDefined();
		expect(runtime.runSync(InstanceAdminService)).toBeDefined();
		expect(runtime.runSync(InstanceAdminImpersonationService)).toBeDefined();
		expect(runtime.runSync(InstanceAdminSessionService)).toBeDefined();
		expect(runtime.runSync(OAuthConnectService)).toBeDefined();
		expect(runtime.runSync(OAuthReturnCapture)).toBeDefined();
		expect(runtime.runSync(DeepLinkClaims)).toBeDefined();
	});
});
