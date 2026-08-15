import type { BackupRun, ListRunsResponse } from "@ryot/contract/modules/backups/schemas";
import type { AsyncResult } from "effect/unstable/reactivity";

import { requestFailureCopy, type RequestFailureState } from "@/api/request-failure";
import { classifyRyotQLResult, type MappedRyotQLResultState } from "@/api/ryotql";

export type BackupRunListState = MappedRyotQLResultState<
	{ readonly status: "empty" } | { readonly status: "ready"; readonly runs: readonly BackupRun[] }
>;

export const mapBackupRunList = (
	result: AsyncResult.AsyncResult<ListRunsResponse, unknown>,
): BackupRunListState => {
	const state = classifyRyotQLResult(result);
	if (state.status !== "ready") {
		return state;
	}
	return state.value.items.length === 0
		? { status: "empty" }
		: { status: "ready", runs: state.value.items };
};

export const backupRunListError = (state: RequestFailureState) =>
	requestFailureCopy(state, { subject: "Your backups", title: "Unable to load backups" });

export const withBackupDownloadLock = async <A>(
	lock: { current: string | undefined },
	runId: string,
	operation: () => Promise<A>,
) => {
	if (lock.current !== undefined) {
		return undefined;
	}
	lock.current = runId;
	try {
		return await operation();
	} finally {
		if (lock.current === runId) {
			lock.current = undefined;
		}
	}
};
