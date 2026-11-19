import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { useSyncExternalStore } from "react";

import type { AuthSessionStore } from "#/modules/auth/service";

export const demoProtectionMessage = kernelMessage("client.demo-protection.unavailable");

export function DemoProtectionMessage() {
	const t = useT();
	return <StatusMessage tone="pending">{t(demoProtectionMessage)}</StatusMessage>;
}

export function useIsDemoSession(session: AuthSessionStore) {
	const snapshot = useSyncExternalStore(
		session.subscribe,
		session.getSnapshot,
		session.getSnapshot,
	);
	return snapshot.status === "authenticated" && snapshot.accessClass === "demo";
}
