import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { router, usePathname } from "expo-router";

import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { useAuthClient } from "@/modules/auth/client";
import { navigationAtom, scopedWorkspaceAtom } from "@/modules/navigation/atoms";
import { savedViewSessionAtom } from "@/modules/saved-views/atoms";
import { emptySavedViewSession } from "@/modules/saved-views/session-state";

import {
	getNavigationHref,
	getNavigationMode,
	getSettingsHref,
	getWorkspaceHref,
	type NavigationItem,
} from "./navigation-data";
import { mapNavigationState, type ReadyNavigationState } from "./navigation-state";

export type ReadyWorkspaceNavigation = ReadyNavigationState & {
	accountName: string;
	accountEmail: string;
	openSettings: () => void;
	accountImage: string | null;
	selectWorkspace: (slug: string) => void;
	navigate: (item: NavigationItem) => void;
};

export type WorkspaceNavigation =
	| { status: "loading" }
	| ReadyWorkspaceNavigation
	| { status: "error"; detail?: string; title: string };

export function useWorkspaceNavigation(): WorkspaceNavigation {
	const client = useAuthClient();
	const pathname = usePathname();
	const scope = useApiScope();
	const { data: session } = client.useSession();
	const workspaceAtom = scopedWorkspaceAtom(scope);
	const setWorkspace = useAtomSet(workspaceAtom);
	const resetSavedViewSession = useAtomSet(savedViewSessionAtom(scope));
	const selectedWorkspace = useAtomValue(workspaceAtom);
	const navigationResult = useAtomValue(navigationAtom(scope));
	const state = mapNavigationState({
		pathname,
		selectedWorkspace,
		result: navigationResult,
	});
	const failure = state.status === "error" ? state.failure : undefined;
	useInternalRequestFailureLogging(`navigation ${failure?.kind} failure`, failure?.cause);
	if (state.status === "error") {
		return { status: "error", title: state.title, detail: state.detail };
	}
	if (state.status === "loading") {
		return state;
	}

	return {
		...state,
		status: "ready",
		accountImage: session?.user.image ?? null,
		accountEmail: session?.user.email ?? "Email unavailable",
		accountName: session?.user.name ?? session?.user.email ?? "Account",
		openSettings: () => router.navigate(getSettingsHref()),
		navigate: (item) => {
			const href = getNavigationHref(item);
			const mode = getNavigationMode(state.activeKey, item);
			if (mode === "dismissTo") {
				router.dismissTo(href);
				return;
			}
			if (mode === "replace") {
				router.replace(href);
				return;
			}
			router.push(href);
		},
		selectWorkspace: (slug) => {
			if (
				slug === state.workspace.slug ||
				!state.data.workspaces.some((item) => item.slug === slug)
			) {
				return;
			}
			setWorkspace(slug);
			resetSavedViewSession(emptySavedViewSession);
			if (router.canDismiss()) {
				router.dismissAll();
			}
			router.replace(getWorkspaceHref());
		},
	};
}
