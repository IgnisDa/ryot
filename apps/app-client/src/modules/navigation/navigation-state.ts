import {
	decodeNavigationResponse,
	type NavigationData,
	type NavigationWorkspace,
} from "@ryot/ryotql-recipes/navigation";
import { Result } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

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
	readonly routeWorkspace?: string;
	readonly selectedWorkspace: string;
	readonly result: AsyncResult.AsyncResult<unknown, unknown>;
}): NavigationState {
	if (AsyncResult.isFailure(props.result)) {
		return {
			status: "error",
			title: "Unable to load navigation",
			failure: { kind: "transport", cause: props.result.cause },
			detail: "The server could not load navigation. Check your connection and try again.",
		};
	}
	if (!AsyncResult.isSuccess(props.result)) {
		return { status: "loading" };
	}

	const decoded = decodeNavigationResponse(props.result.value);
	if (Result.isFailure(decoded)) {
		return {
			status: "error",
			title: "Unable to display navigation",
			failure: { kind: "malformed", cause: decoded.failure },
			detail: "The server returned navigation data that could not be displayed. Try again later.",
		};
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

	const workspace = getCurrentWorkspace(
		data.workspaces,
		props.routeWorkspace,
		props.selectedWorkspace,
	);

	return {
		data,
		workspace,
		status: "ready",
		activeKey: getActiveNavigationKey(props.pathname),
		items: getNavigationItems({ data, workspaceSlug: workspace.slug }),
	};
}
