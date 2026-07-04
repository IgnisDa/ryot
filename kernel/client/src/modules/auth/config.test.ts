import type { SystemConfigResponse } from "@ryot/contract/modules/system/contract";
import { describe, expect, it } from "vitest";

import { deriveAuthMethods } from "#/modules/auth/config";

const systemConfig = (auth: SystemConfigResponse["auth"]): SystemConfigResponse => ({
	auth,
	analytics: {},
	pro: { isServerKeyValidated: false },
	notifications: { smtpEnabled: false },
	fileStorage: { temporaryUploadProvider: "local", preferredPermanentUploadProvider: "local" },
});

describe("authentication config", () => {
	it("derives enabled local and OIDC methods", () => {
		expect(
			deriveAuthMethods(
				systemConfig({
					oidcEnabled: true,
					signupAllowed: true,
					localAuthDisabled: false,
					oidcButtonLabel: "Company login",
				}),
			),
		).toEqual({ emailSignIn: true, emailSignUp: true, oidc: { buttonLabel: "Company login" } });
	});

	it("does not expose disabled methods", () => {
		expect(
			deriveAuthMethods(
				systemConfig({ oidcEnabled: false, signupAllowed: true, localAuthDisabled: true }),
			),
		).toEqual({ oidc: undefined, emailSignIn: false, emailSignUp: false });
	});
});
