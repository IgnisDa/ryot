import { Effect } from "effect";

import { makeAuthorizationState } from "#/modules/auth/authorization";
import type { OAuthTokenService } from "#/modules/auth/token-service";

export const makeOAuthTokenServiceStub = (
	overrides: Partial<OAuthTokenService["Service"]> = {},
): OAuthTokenService["Service"] => ({
	clear: () => Effect.void,
	logout: () => Effect.succeed(null),
	userInfo: () => Effect.succeed(null),
	authorization: makeAuthorizationState(),
	accessToken: () => Effect.succeed(null),
	rejectAuthorization: () => Effect.die("not used"),
	completeAuthorization: () => Effect.die("not used"),
	...overrides,
});
