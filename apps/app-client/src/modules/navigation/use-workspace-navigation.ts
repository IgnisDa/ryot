import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Cause, Effect } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { router, useGlobalSearchParams, usePathname } from "expo-router";
import { useEffect } from "react";

import { useAuthClient } from "@/modules/auth/client";
import { navigationAtom, scopedWorkspaceAtom } from "@/modules/navigation/atoms";
import { useServerUrl } from "@/modules/server/state";
import { CLOUD_URL } from "@/modules/server/url";

import { getNavigationHref, type NavigationItem } from "./navigation-data";
import {
	mapNavigationState,
	type NavigationFailure,
	type ReadyNavigationState,
} from "./navigation-state";

export type ReadyWorkspaceNavigation = ReadyNavigationState & {
	accountName: string;
	accountEmail: string;
	selectWorkspace: (slug: string) => void;
	navigate: (item: NavigationItem) => void;
};

export type WorkspaceNavigation =
	| { status: "loading" }
	| ReadyWorkspaceNavigation
	| { status: "error"; detail?: string; title: string };

const unavailableNavigationAtom = Atom.make(AsyncResult.initial());
const unavailableWorkspaceAtom = Atom.make("media");

function useNavigationFailureLogging(failure: NavigationFailure | undefined) {
	const kind = failure?.kind;
	let detail: string | undefined;
	if (failure) {
		detail = Cause.isCause(failure.cause) ? Cause.pretty(failure.cause) : String(failure.cause);
	}
	useEffect(() => {
		if (!kind || !detail) {
			return;
		}
		Effect.runSync(Effect.logWarning(`navigation ${kind} failure`, detail));
	}, [detail, kind]);
}

export function useWorkspaceNavigation(): WorkspaceNavigation {
	const client = useAuthClient();
	const pathname = usePathname();
	const serverUrl = useServerUrl() ?? CLOUD_URL;
	const { data: session } = client.useSession();
	const scope = session ? { serverUrl, userId: session.user.id } : undefined;
	const workspaceAtom = scope ? scopedWorkspaceAtom(scope) : unavailableWorkspaceAtom;
	const setWorkspace = useAtomSet(workspaceAtom);
	const selectedWorkspace = useAtomValue(workspaceAtom);
	const navigationResult = useAtomValue(scope ? navigationAtom(scope) : unavailableNavigationAtom);
	const params = useGlobalSearchParams<{ workspace?: string }>();
	const routeWorkspace = Array.isArray(params.workspace) ? params.workspace[0] : params.workspace;
	const state = mapNavigationState({
		pathname,
		routeWorkspace,
		selectedWorkspace,
		result: navigationResult,
	});
	useNavigationFailureLogging(state.status === "error" ? state.failure : undefined);
	if (state.status === "error") {
		return { status: "error", title: state.title, detail: state.detail };
	}
	if (state.status === "loading") {
		return state;
	}

	return {
		...state,
		status: "ready",
		accountEmail: session?.user.email ?? "Email unavailable",
		accountName: session?.user.name ?? session?.user.email ?? "Account",
		navigate: (item) => router.navigate(getNavigationHref(state.workspace.slug, item)),
		selectWorkspace: (slug) => {
			if (!state.data.workspaces.some((item) => item.slug === slug)) {
				return;
			}
			setWorkspace(slug);
			router.replace({ pathname: "/[workspace]", params: { workspace: slug } });
		},
	};
}
