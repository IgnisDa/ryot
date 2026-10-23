import { StoredTokenSet } from "@ryot-app/contract/oauth";
import { Schema } from "effect";

import { decodeOAuthTokenClaims } from "./token-claims";

const OAuthTokenIdentity = Schema.Struct({
	sub: Schema.String,
	sid: Schema.optional(Schema.String),
});

export const decodeOAuthTokenIdentity = (token: string): typeof OAuthTokenIdentity.Type | null => {
	try {
		return decodeOAuthTokenClaims(token, OAuthTokenIdentity);
	} catch {
		return null;
	}
};

const accessTokenFromStorage = (value: string) => {
	try {
		return Schema.decodeSync(Schema.fromJsonString(StoredTokenSet))(value).accessToken;
	} catch {
		return undefined;
	}
};

export const oauthSessionBoundaryChanged = (previous: string | null, next: string | null) => {
	if (previous === null || next === null) {
		return previous !== next;
	}
	const previousToken = accessTokenFromStorage(previous);
	const nextToken = accessTokenFromStorage(next);
	if (previousToken === undefined || nextToken === undefined) {
		return previousToken !== nextToken;
	}
	const previousIdentity = decodeOAuthTokenIdentity(previousToken);
	const nextIdentity = decodeOAuthTokenIdentity(nextToken);
	if (previousIdentity === null || nextIdentity === null) {
		return previousIdentity !== nextIdentity;
	}
	return previousIdentity.sub !== nextIdentity.sub || previousIdentity.sid !== nextIdentity.sid;
};

export const handleOAuthSessionStorageEvent = (
	event: Pick<StorageEvent, "key" | "newValue" | "oldValue">,
	key: string,
	reload: () => void,
) => {
	if (event.key === key && oauthSessionBoundaryChanged(event.oldValue, event.newValue)) {
		reload();
	}
};

export const subscribeOAuthSessionBoundary = (
	target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
	key: string,
	reload: () => void,
) => {
	const listener: EventListener = (event) => {
		if (event instanceof StorageEvent) {
			handleOAuthSessionStorageEvent(event, key, reload);
		}
	};
	target.addEventListener("storage", listener);
	return () => target.removeEventListener("storage", listener);
};
