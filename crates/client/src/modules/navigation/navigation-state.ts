import type { NavigationData, NavigationWorkspace } from "@ryot-app/ryotql-recipes/navigation";
import type { AsyncResult } from "effect/unstable/reactivity";

import { classifyRyotQLResult } from "@/api/ryotql";

import {
	getActiveNavigationKey,
	getCurrentWorkspace,
	getEnabledItems,
	getNavigationItems,
	type NavigationItems,
} from "./navigation-data";

export type NavigationFailure = {
	readonly cause: unknown;
	readonly kind: "malformed" | "transport";
};

export type ReadyNavigationState = {
	readonly status: "ready";
	readonly activeKey: string;
	readonly data: NavigationData;
	readonly items: NavigationItems;
	readonly workspace: NavigationWorkspace;
};

export type NavigationState =
	| ReadyNavigationState
	| { readonly status: "loading" }
	| {
			readonly title: string;
			readonly status: "error";
			readonly detail?: string;
			readonly failure?: NavigationFailure;
	  };

export function mapNavigationState(props: {
	readonly pathname: string;
	readonly selectedWorkspace: string;
	readonly result: AsyncResult.AsyncResult<NavigationData, unknown>;
}): NavigationState {
	const state = classifyRyotQLResult(props.result);
	if (state.status === "malformed" || state.status === "transport-error") {
		const malformed = state.status === "malformed";
		return {
			status: "error",
			failure: { kind: malformed ? "malformed" : "transport", cause: state.cause },
			title: malformed ? "Unable to display navigation" : "Unable to load navigation",
			detail: malformed
				? "The server returned navigation data that could not be displayed. Try again later."
				: "The server could not load navigation. Check your connection and try again.",
		};
	}
	if (state.status === "loading") {
		return { status: "loading" };
	}

	const data = {
		...state.value,
		workspaces: getEnabledItems(state.value.workspaces),
	} satisfies NavigationData;
	if (data.workspaces.length === 0) {
		return {
			status: "error",
			title: "No enabled workspaces",
			detail: "Enable a plugin to create a workspace.",
		};
	}

	const workspace = getCurrentWorkspace(data.workspaces, props.selectedWorkspace);

	return {
		data,
		workspace,
		status: "ready",
		activeKey: getActiveNavigationKey(props.pathname),
		items: getNavigationItems({ data, workspaceSlug: workspace.slug }),
	};
}
