import type { Message } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Effect } from "effect";
import { useEffect, useState, useSyncExternalStore } from "react";

import type { ServerOrigin } from "#/api/origin";
import { browserSessionChangeKey } from "#/modules/auth/browser-session";
import {
	awaitDocumentVisible,
	waitForImpersonationExpiry,
} from "#/modules/auth/impersonation-expiry";
import { RuntimeOAuthClientService } from "#/modules/auth/runtime-client";
import { AuthService } from "#/modules/auth/service";
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
	const [stopError, setStopError] = useState<Message>();
	const stopImpersonation = () => {
		setStopPending(true);
		setStopError(undefined);
		runtime.runFork(
			auth.signOut(server).pipe(
				Effect.matchCause({
					onFailure: () => {
						setStopPending(false);
						setStopError(kernelMessage("client.auth.impersonation.stop-failed"));
					},
					onSuccess: (launched) => {
						setStopPending(false);
						if (!launched) {
							setStopError(kernelMessage("client.auth.impersonation.logout-failed"));
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
		const onStorage = (event: StorageEvent) => {
			if (event.key === browserSessionChangeKey) {
				window.location.reload();
			}
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, [runtime]);
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
