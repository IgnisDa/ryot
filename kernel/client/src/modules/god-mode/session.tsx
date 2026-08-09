import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import { randomUUID } from "expo-crypto";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
	canonicalAdminSession,
	clearAdminSession,
	registerAdminSession,
	type AdminSession,
} from "@/api/admin-api";

export const GOD_MODE_INVALID_TOKEN = "That admin access token is invalid.";

export type GodModeSessionState =
	| { readonly status: "locked"; readonly error: string | null }
	| { readonly status: "unlocked"; readonly sessionId: string };

const godModeSessionAtom = Atom.make<GodModeSessionState>({ error: null, status: "locked" });

export function useGodModeLock(serverUrl: string) {
	const state = useAtomValue(godModeSessionAtom);
	const setState = useAtomSet(godModeSessionAtom);

	return {
		state,
		unlock: (adminToken: string) => {
			const sessionId = randomUUID();
			registerAdminSession({ serverUrl, sessionId, adminToken });
			setState({ sessionId, status: "unlocked" });
		},
		lock: (error: string | null) => {
			if (state.status === "unlocked") {
				clearAdminSession({ serverUrl, sessionId: state.sessionId });
			}
			setState({ error, status: "locked" });
		},
	};
}

type GodModeSession = {
	readonly scope: AdminSession;
	readonly lock: (error: string | null) => void;
};

const GodModeSessionContext = createContext<GodModeSession | undefined>(undefined);

export function GodModeSessionProvider(
	props: AdminSession & {
		readonly children: ReactNode;
		readonly lock: (error: string | null) => void;
	},
) {
	const { lock, serverUrl, sessionId } = props;
	const session = useMemo(
		() => ({ lock, scope: canonicalAdminSession({ serverUrl, sessionId }) }),
		[lock, serverUrl, sessionId],
	);
	return (
		<GodModeSessionContext.Provider value={session}>
			{props.children}
		</GodModeSessionContext.Provider>
	);
}

export function useGodModeSession() {
	const session = useContext(GodModeSessionContext);
	if (!session) {
		throw new Error("useGodModeSession must be used within GodModeSessionProvider");
	}
	return session;
}
