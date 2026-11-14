import { Effect } from "effect";
import { useEffect, useState, useSyncExternalStore } from "react";

import type { ServerOrigin } from "#/api/origin";
import {
	awaitDocumentVisible,
	waitForImpersonationExpiry,
} from "#/modules/auth/impersonation-expiry";
import { oauthTokenKey } from "#/modules/auth/oauth-storage";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService } from "#/modules/auth/service";
import { subscribeOAuthSessionBoundary } from "#/modules/auth/token-identity";
import type { ClientRuntime } from "#/runtime";

export function useAuthenticatedSession(runtime: ClientRuntime, server: ServerOrigin) {
	const auth = runtime.runSync(AuthService);
	const session = auth.session(server);
	const authSnapshot = useSyncExternalStore(
		session.subscribe,
		session.getSnapshot,
		session.getSnapshot,
	);
	const impersonation =
		authSnapshot.status === "authenticated" ? authSnapshot.impersonation : undefined;
	const [stopPending, setStopPending] = useState(false);
	const [stopError, setStopError] = useState<string>();
	const stopImpersonation = () => {
		setStopPending(true);
		setStopError(undefined);
		runtime.runFork(
			auth.signOut(server).pipe(
				Effect.matchCause({
					onFailure: () => {
						setStopPending(false);
						setStopError("Could not stop impersonation. Please try again.");
					},
					onSuccess: (launched) => {
						setStopPending(false);
						if (!launched) {
							setStopError("Could not open the server logout page. Please try again.");
						}
					},
				}),
			),
		);
	};
	useEffect(() => {
		if (runtime.runSync(RuntimeOAuthClientService).isNative) {
			return undefined;
		}
		return subscribeOAuthSessionBoundary(window, oauthTokenKey(server), () =>
			window.location.reload(),
		);
	}, [runtime, server]);
	useEffect(() => {
		if (impersonation === undefined) {
			return undefined;
		}
		const controller = new AbortController();
		runtime.runFork(
			waitForImpersonationExpiry(impersonation.expiresAt, awaitDocumentVisible).pipe(
				Effect.andThen(auth.clearSession(server)),
				Effect.andThen(Effect.sync(() => window.location.replace("/instance-admin/users"))),
			),
			{ signal: controller.signal },
		);
		return () => controller.abort();
	}, [auth, impersonation, runtime, server]);
	return { session, stopError, stopPending, authSnapshot, impersonation, stopImpersonation };
}
