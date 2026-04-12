import type { NavigationData, NavigationWorkspace } from "@ryot/ryotql-recipes/navigation";
import { AsyncResult } from "effect/unstable/reactivity";

import { isRyotQLMalformedResultCause } from "@/api/ryotql";

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
	if (AsyncResult.isFailure(props.result)) {
		const malformed = isRyotQLMalformedResultCause(props.result.cause);
		return {
			status: "error",
			title: malformed ? "Unable to display navigation" : "Unable to load navigation",
			failure: { kind: malformed ? "malformed" : "transport", cause: props.result.cause },
			detail: malformed
				? "The server returned navigation data that could not be displayed. Try again later."
				: "The server could not load navigation. Check your connection and try again.",
		};
	}
	if (!AsyncResult.isSuccess(props.result)) {
		return { status: "loading" };
	}

	const data = {
		...props.result.value,
		workspaces: getEnabledItems(props.result.value.workspaces),
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
