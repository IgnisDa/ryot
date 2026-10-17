import { StoredTokenSet } from "@ryot-app/contract/oauth";
import { Schema, Semaphore } from "effect";

import type { ServerOrigin } from "#/api/origin";
import type { AuthSessionSnapshot, SettledAuthSession } from "#/modules/auth/service";
import { makeSingleFlight } from "#/modules/auth/single-flight";
import type { OAuthTokenError } from "#/modules/auth/token-service";

const equivalentTokens = Schema.toEquivalence(Schema.NullOr(StoredTokenSet));
const makeAuthorization = (tokens: StoredTokenSet | null) => ({
	tokens,
	resolution: makeSingleFlight<SettledAuthSession, OAuthTokenError>(),
	refresh: makeSingleFlight<StoredTokenSet | null, OAuthTokenError>(),
});

export type Authorization = ReturnType<typeof makeAuthorization>;

const makeServerAuthorization = () => {
	let current = makeAuthorization(null);
	let restoreAllowed = true;
	let snapshot: AuthSessionSnapshot = { status: "pending" };
	const listeners = new Set<() => void>();
	const mutex = Semaphore.makeUnsafe(1);
	const publish = (authorization: Authorization, next: AuthSessionSnapshot) => {
		if (
			current !== authorization ||
			(snapshot.status === next.status && next.status !== "authenticated")
		) {
			return;
		}
		snapshot = next;
		listeners.forEach((listener) => listener());
	};
	const adopt = (tokens: StoredTokenSet | null) => {
		current = makeAuthorization(tokens);
		publish(current, { status: tokens === null ? "missing" : "pending" });
		return current;
	};
	return {
		mutex,
		publish,
		get current() {
			return current;
		},
		isCurrent: (authorization: Authorization) => authorization === current,
		replace: (tokens: StoredTokenSet | null) => {
			restoreAllowed = tokens !== null;
			return adopt(tokens);
		},
		observe: (tokens: StoredTokenSet | null) =>
			!restoreAllowed || equivalentTokens(tokens, current.tokens) ? current : adopt(tokens),
		store: {
			getSnapshot: () => snapshot,
			subscribe: (listener: () => void) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
		},
	};
};

export const makeAuthorizationState = () => {
	const servers = new Map<ServerOrigin, ReturnType<typeof makeServerAuthorization>>();
	return {
		forServer: (origin: ServerOrigin) => {
			const existing = servers.get(origin);
			if (existing) {
				return existing;
			}
			const created = makeServerAuthorization();
			servers.set(origin, created);
			return created;
		},
	};
};
