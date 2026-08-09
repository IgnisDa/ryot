import type { ListedImportSource } from "@ryot/contract/modules/imports/schemas";
import type {
	ImportRunDetail,
	ImportRunFailure,
	ImportRunList,
	ImportRunSummary,
} from "@ryot/ryotql-recipes/import-runs";
import type { AsyncResult } from "effect/unstable/reactivity";

import { classifyRyotQLResult, type MappedRyotQLResultState } from "@/api/ryotql";

export type ImportRunListState = MappedRyotQLResultState<
	| { readonly status: "empty" }
	| {
			readonly status: "ready";
			readonly hasMore: boolean;
			readonly runs: readonly ImportRunSummary[];
	  }
>;

export type ImportRunDetailState = MappedRyotQLResultState<
	| { readonly status: "not-found" }
	| {
			readonly status: "ready";
			readonly run: ImportRunSummary;
			readonly hasMoreFailures: boolean;
			readonly failures: readonly ImportRunFailure[];
	  }
>;

type ImportFailureState = { readonly status: "transport-error" | "malformed" };

export const mapImportRunList = (
	result: AsyncResult.AsyncResult<ImportRunList, unknown>,
): ImportRunListState => {
	const state = classifyRyotQLResult(result);
	if (state.status !== "ready") {
		return state;
	}
	return state.value.items.length === 0
		? { status: "empty" }
		: {
				status: "ready",
				runs: state.value.items,
				hasMore: state.value.pageInfo.hasMore,
			};
};

export const mapImportRunDetail = (
	result: AsyncResult.AsyncResult<ImportRunDetail, unknown>,
): ImportRunDetailState => {
	const state = classifyRyotQLResult(result);
	if (state.status !== "ready") {
		return state;
	}
	const run = state.value.run;
	if (run === undefined) {
		return { status: "not-found" };
	}
	return {
		run,
		status: "ready",
		failures: state.value.failures.items,
		hasMoreFailures: state.value.failures.pageInfo.hasMore,
	};
};

export const mapImportSourceNames = (
	result: AsyncResult.AsyncResult<readonly Pick<ListedImportSource, "slug" | "name">[], unknown>,
): ReadonlyMap<string, string> => {
	const state = classifyRyotQLResult(result);
	return state.status === "ready"
		? new Map(state.value.map((source) => [source.slug, source.name]))
		: new Map();
};

export const importRunListError = (state: ImportFailureState) => ({
	title: "Unable to load imports",
	detail:
		state.status === "transport-error"
			? "Your import history could not be loaded. Check the server and try again."
			: "Your import history came back in a form that could not be displayed. Try again later.",
});

export const importRunDetailError = (state: ImportFailureState) => ({
	title: "Unable to load this import",
	detail:
		state.status === "transport-error"
			? "This import could not be loaded. Check the server and try again."
			: "This import came back in a form that could not be displayed. Try again later.",
});
