import { useAtomValue } from "@effect/atom-react";
import {
	decodeNavigationResponse,
	type NavigationData,
	type NavigationWorkspace,
} from "@ryot/ryotql-recipes/navigation";
import { Cause, Result } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { router, useGlobalSearchParams, usePathname } from "expo-router";

import { useAuthClient } from "@/modules/auth/client";
import { navigationAtom } from "@/modules/navigation/atoms";
import { useSetWorkspace, useWorkspace } from "@/modules/server/state";

import {
	getActiveNavigationKey,
	getCurrentWorkspace,
	getEnabledItems,
	getNavigationHref,
	getNavigationItems,
	type NavigationItem,
	type NavigationItems,
} from "./navigation-data";

export type ReadyWorkspaceNavigation = {
	status: "ready";
	activeKey: string;
	accountName: string;
	accountEmail: string;
	data: NavigationData;
	items: NavigationItems;
	workspace: NavigationWorkspace;
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
	const setWorkspace = useSetWorkspace();
	const selectedWorkspace = useWorkspace();
	const { data: session } = client.useSession();
	const navigationResult = useAtomValue(navigationAtom);
	const params = useGlobalSearchParams<{ workspace?: string }>();
	const routeWorkspace = Array.isArray(params.workspace) ? params.workspace[0] : params.workspace;

	if (AsyncResult.isFailure(navigationResult)) {
		return {
			status: "error",
			title: "Unable to load navigation",
			detail: Cause.pretty(navigationResult.cause),
		};
	}
	if (!AsyncResult.isSuccess(navigationResult)) {
		return { status: "loading" };
	}

	const decoded = decodeNavigationResponse(navigationResult.value);
	if (Result.isFailure(decoded)) {
		return { status: "error", title: "Unable to load navigation", detail: String(decoded.failure) };
	}
	const data = {
		...decoded.success,
		workspaces: getEnabledItems(decoded.success.workspaces),
	} satisfies NavigationData;
	if (data.workspaces.length === 0) {
		return {
			status: "error",
			title: "No enabled workspaces",
			detail: "Enable a plugin to create a workspace.",
		};
	}

	const workspace = getCurrentWorkspace(data.workspaces, routeWorkspace, selectedWorkspace);
	if (!workspace) {
		return { status: "error", title: "No workspace selected" };
	}
	const items = getNavigationItems({ data, workspaceSlug: workspace.slug });

	return {
		data,
		items,
		workspace,
		status: "ready",
		activeKey: getActiveNavigationKey(pathname),
		accountEmail: session?.user.email ?? "Email unavailable",
		accountName: session?.user.name ?? session?.user.email ?? "Account",
		navigate: (item) => router.navigate(getNavigationHref(workspace.slug, item)),
		selectWorkspace: (slug) => {
			if (!data.workspaces.some((item) => item.slug === slug)) {
				return;
			}
			setWorkspace(slug);
			router.replace({ pathname: "/[workspace]", params: { workspace: slug } });
		},
	};
}
