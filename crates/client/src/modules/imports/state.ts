import type { ListedImportSource } from "@ryot/contract/modules/imports/schemas";
import type {
	ImportRunDetail,
	ImportRunFailure,
	ImportRunList,
	ImportRunSummary,
} from "@ryot/ryotql-recipes/import-runs";
import type { AsyncResult } from "effect/unstable/reactivity";

import { requestFailureCopy, type RequestFailureState } from "@/api/request-failure";
import { classifyRyotQLResult, type MappedRyotQLResultState } from "@/api/ryotql";

export type ImportRunListState = MappedRyotQLResultState<
	| { readonly status: "empty" }
	| {
			readonly status: "ready";
			readonly hasMore: boolean;
			readonly runs: readonly ImportRunSummary[];
	  }
>;

export type ImportSourceListState = MappedRyotQLResultState<
	| { readonly status: "empty" }
	| { readonly status: "ready"; readonly sources: readonly ListedImportSource[] }
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

export const mapImportSourceList = (
	result: AsyncResult.AsyncResult<readonly ListedImportSource[], unknown>,
): ImportSourceListState => {
	const state = classifyRyotQLResult(result);
	if (state.status !== "ready") {
		return state;
	}
	return state.value.length === 0 ? { status: "empty" } : { status: "ready", sources: state.value };
};

export const mapImportSourceNames = (
	result: AsyncResult.AsyncResult<readonly Pick<ListedImportSource, "slug" | "name">[], unknown>,
): ReadonlyMap<string, string> => {
	const state = classifyRyotQLResult(result);
	return state.status === "ready"
		? new Map(state.value.map((source) => [source.slug, source.name]))
		: new Map();
};

export const importRunListError = (state: RequestFailureState) =>
	requestFailureCopy(state, { subject: "Your import history", title: "Unable to load imports" });

export const importRunDetailError = (state: RequestFailureState) =>
	requestFailureCopy(state, { subject: "This import", title: "Unable to load this import" });
