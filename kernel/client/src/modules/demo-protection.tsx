import { StatusMessage } from "@ryot-app/client-ui-sdk";
import { useSyncExternalStore } from "react";

import type { AuthSessionStore } from "#/modules/auth/service";

export const DEMO_PROTECTION_MESSAGE =
	"This operation is unavailable while using the shared demo account.";

export function useIsDemoSession(session: AuthSessionStore) {
	const snapshot = useSyncExternalStore(
		session.subscribe,
		session.getSnapshot,
		session.getSnapshot,
	);
	return snapshot.status === "authenticated" && snapshot.accessClass === "demo";
}

export function DemoProtectionMessage() {
	return <StatusMessage tone="pending">{DEMO_PROTECTION_MESSAGE}</StatusMessage>;
}
