import type { SystemConfigResponse } from "@ryot-app/contract/modules/system/contract";

export const deriveAuthMethods = (config: SystemConfigResponse) => ({
	emailSignIn: !config.auth.localAuthDisabled,
	emailSignUp: !config.auth.localAuthDisabled && config.auth.signupAllowed,
	oidc: config.auth.oidcEnabled ? { buttonLabel: config.auth.oidcButtonLabel } : undefined,
});
