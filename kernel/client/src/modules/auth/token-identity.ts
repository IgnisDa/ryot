import type { StoredTokenSet } from "@ryot-app/contract/oauth";
import { Option, Schema } from "effect";

import { decodeOAuthTokenClaims } from "./token-claims";

const OAuthTokenIdentity = Schema.Struct({
	sub: Schema.String,
	sid: Schema.optional(Schema.String),
});

export const decodeOAuthTokenIdentity = (token: string): null | typeof OAuthTokenIdentity.Type =>
	Option.getOrNull(decodeOAuthTokenClaims(token, OAuthTokenIdentity));

/** Who the tokens sign in as: rotating tokens for the same user and session keeps the key. */
export const oauthTokenSessionKey = (tokens: null | StoredTokenSet) => {
	if (tokens === null) {
		return null;
	}
	const identity = decodeOAuthTokenIdentity(tokens.accessToken);
	return identity === null
		? tokens.accessToken
		: JSON.stringify([identity.sub, identity.sid ?? null]);
};
