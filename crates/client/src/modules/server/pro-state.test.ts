import type { SystemConfigResponse } from "@ryot-app/contract/modules/system/contract";
import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vitest";

import { isServerKeyValidated } from "./pro-state";

const config = (validated: boolean) =>
	({
		analytics: { umami: undefined },
		notifications: { smtpEnabled: false },
		pro: { isServerKeyValidated: validated },
		auth: { oidcEnabled: false, signupAllowed: true, localAuthDisabled: false },
		fileStorage: { temporaryUploadProvider: "local", preferredPermanentUploadProvider: "local" },
	}) satisfies SystemConfigResponse;

describe("server key validation", () => {
	it("reads the validated flag from a successful config load", () => {
		expect(isServerKeyValidated(AsyncResult.success(config(true)))).toBe(true);
		expect(isServerKeyValidated(AsyncResult.success(config(false)))).toBe(false);
	});

	it("defaults to false while loading or on failure, matching the backend fallback", () => {
		expect(isServerKeyValidated(AsyncResult.initial())).toBe(false);
		expect(isServerKeyValidated(AsyncResult.failure(Cause.fail("offline")))).toBe(false);
	});
});
