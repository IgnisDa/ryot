import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { ImportRunId } from "@ryot/contract/schema/brands";
import { Exit } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { ImportStatusPill } from "@/modules/import-runs/import-status-pill";
import {
	canDeleteImportRun,
	importRunDurationLabel,
	importRunTimestampLabel,
	importSourceName,
	isTerminalImportRunStatus,
} from "@/modules/import-runs/run-presentation";
import {
	IMPORT_RUN_POLL_MS,
	useImportRunPolling,
} from "@/modules/import-runs/use-import-run-polling";
import { ChildScreenFrame } from "@/modules/navigation/child-screen-frame";
import type { HeaderOverflowItem } from "@/modules/navigation/header/header-overflow-menu";
import { copyTextToClipboard } from "@/modules/ui/clipboard";

import {
	IMPORT_FAILURES_PAGE_SIZE,
	deleteImportRunAtom,
	importRunAtom,
	importRunReactivityKeys,
	importSourcesAtom,
} from "./atoms";
import { ImportRunDeleteSheet } from "./import-run-delete-sheet";
import { ImportRunView } from "./import-run-view";
import { mapImportRunDetail, mapImportSourceNames } from "./state";

const returnToList = () => {
	if (router.canGoBack()) {
		router.back();
		return;
	}
	router.replace("/settings/import-data");
};

export function ImportRunScreen(props: { runId: string }) {
	const scope = useApiScope();
	const [isDeleting, setIsDeleting] = useState(false);
	const [isConfirming, setIsConfirming] = useState(false);
	const [deleteFailure, setDeleteFailure] = useState<unknown>();
	const [failureLimit, setFailureLimit] = useState(IMPORT_FAILURES_PAGE_SIZE);
	const runAtom = importRunAtom({ failureLimit, scope, runId: props.runId });
	const result = useAtomValue(runAtom);
	const refresh = useAtomRefresh(runAtom);
	const sources = useAtomValue(importSourcesAtom(scope));
	const deleteRun = useAtomSet(deleteImportRunAtom(scope), { mode: "promiseExit" });
	const state = mapImportRunDetail(result);
	const run = state.status === "ready" ? state.run : undefined;
	const loadedFailures = state.status === "ready" ? state.failures.length : 0;
	const nowMs = Date.now();
	const sourceNames = mapImportSourceNames(sources);
	useInternalRequestFailureLogging(
		"import run query failed",
		AsyncResult.isFailure(result) ? result.cause : undefined,
	);
	useInternalRequestFailureLogging("import run delete failed", deleteFailure);
	useImportRunPolling({
		refresh,
		intervalMs: IMPORT_RUN_POLL_MS,
		enabled: run !== undefined && !isTerminalImportRunStatus(run.status),
	});

	const overflowItems: readonly HeaderOverflowItem[] | undefined =
		run !== undefined && canDeleteImportRun(run.status)
			? [{ label: "Delete record", isDestructive: true, onPress: () => setIsConfirming(true) }]
			: undefined;
	const duration = run === undefined ? undefined : importRunDurationLabel(run, nowMs);

	async function confirmDelete() {
		setIsDeleting(true);
		setDeleteFailure(undefined);
		const exit = await deleteRun({
			params: { runId: ImportRunId.make(props.runId) },
			reactivityKeys: importRunReactivityKeys(scope),
		});
		setIsDeleting(false);
		if (Exit.isFailure(exit)) {
			setDeleteFailure(exit.cause);
			return;
		}
		setIsConfirming(false);
		returnToList();
	}

	return (
		<ChildScreenFrame
			overflowItems={overflowItems}
			overlay={
				isConfirming && run !== undefined ? (
					<ImportRunDeleteSheet
						run={run}
						pending={isDeleting}
						onConfirm={() => void confirmDelete()}
						hasFailed={deleteFailure !== undefined}
						onClose={() => {
							setDeleteFailure(undefined);
							setIsConfirming(false);
						}}
					/>
				) : undefined
			}
			title={run === undefined ? "Import" : importSourceName(run.source, sourceNames)}
			meta={
				run === undefined ? undefined : (
					<View className="gap-2">
						<Text className="font-ui text-xs text-text-subtle">
							{`Import · ${importRunTimestampLabel(run.createdAt)}`}
						</Text>
						<View className="flex-row items-center gap-2">
							<ImportStatusPill status={run.status} />
							{duration === undefined ? null : (
								<Text className="font-ui text-xs tabular-nums text-text-subtle">{duration}</Text>
							)}
						</View>
					</View>
				)
			}
		>
			<View className="w-full max-w-2xl self-center">
				<ImportRunView
					state={state}
					nowMs={nowMs}
					onRetry={refresh}
					sourceNames={sourceNames}
					onCopy={copyTextToClipboard}
					isLoadingMore={result.waiting && loadedFailures < failureLimit}
					onShowMore={() => setFailureLimit(failureLimit + IMPORT_FAILURES_PAGE_SIZE)}
				/>
			</View>
		</ChildScreenFrame>
	);
}
