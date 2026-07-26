import type { ImportRunFailure, ImportRunSummary } from "@ryot/ryotql-recipes/import-runs";
import clsx from "clsx";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { ImportProgressBar } from "@/modules/import-runs/import-progress-bar";
import { ImportStatusPill } from "@/modules/import-runs/import-status-pill";
import {
	formatImportCount,
	importRunCountsLabel,
	importRunDurationLabel,
	importRunFailureNotice,
	importRunProgress,
	importRunProgressValue,
	importRunProvenanceLabel,
	importRunTimestampLabel,
	importSourceName,
} from "@/modules/import-runs/run-presentation";
import { AppButton } from "@/modules/ui/button";
import { AppStatusState } from "@/modules/ui/status-state";

import {
	buildImportFailureClipboardText,
	groupImportFailuresByStage,
	importFailureContextEntries,
	importFailureRowLabel,
} from "./failure-presentation";
import { importRunDetailError, type ImportRunDetailState } from "./state";

function RunHeading(props: {
	readonly sourceName: string;
	readonly run: ImportRunSummary;
	readonly duration: string | undefined;
}) {
	return (
		<View className="hidden gap-1.5 md:flex">
			<Text className="font-ui-medium text-[11px] uppercase tracking-[0.8px] text-text-subtle">
				{`Import · ${importRunTimestampLabel(props.run.createdAt)}`}
			</Text>
			<Text className="font-display-semibold text-3xl text-text">{props.sourceName}</Text>
			<View className="flex-row items-center gap-2">
				<ImportStatusPill status={props.run.status} />
				{props.duration === undefined ? null : (
					<Text className="font-ui text-xs tabular-nums text-text-subtle">{props.duration}</Text>
				)}
			</View>
		</View>
	);
}

function RunCounts(props: { readonly run: ImportRunSummary }) {
	const progress = importRunProgress(props.run);
	const figures = [
		{ label: "Read", value: formatImportCount(props.run.processedItems) },
		{ label: "Added", value: formatImportCount(props.run.importedItems) },
		{ label: "Failed", value: formatImportCount(props.run.failedItems) },
	];
	return (
		<View className="gap-4 rounded-2xl border border-border bg-surface p-4">
			<View className="flex-row">
				{figures.map((figure) => (
					<View key={figure.label} className="flex-1 gap-0.5">
						<Text className="font-ui-medium text-[11px] uppercase tracking-[0.8px] text-text-subtle">
							{figure.label}
						</Text>
						<Text className="font-ui-semibold text-xl tabular-nums text-text">{figure.value}</Text>
					</View>
				))}
			</View>
			<View className="gap-2">
				<ImportProgressBar progress={progress} value={importRunProgressValue(props.run)} />
				<View className="flex-row items-center justify-between gap-3">
					<Text className="font-ui text-xs tabular-nums text-text-muted">
						{importRunCountsLabel(props.run)}
					</Text>
					<Text className="font-ui-medium text-xs text-text-subtle">{progress.label}</Text>
				</View>
			</View>
		</View>
	);
}

function FailureRow(props: { readonly failure: ImportRunFailure; readonly pill: string }) {
	const [isExpanded, setIsExpanded] = useState(false);
	const label = importFailureRowLabel(props.failure);
	const entries = importFailureContextEntries(props.failure.context);
	return (
		<View className="border-b border-border">
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={label}
				className="flex-row items-center gap-3 py-3"
				accessibilityState={{ expanded: isExpanded }}
				onPress={() => setIsExpanded(!isExpanded)}
			>
				<View className="min-w-0 flex-1 gap-0.5">
					<Text numberOfLines={1} className="font-ui-medium text-sm text-text">
						{label}
					</Text>
					<Text numberOfLines={2} className="font-ui text-xs text-text-muted">
						{props.failure.message}
					</Text>
				</View>
				<Text className="font-ui-medium text-[11px] text-text-subtle">{props.pill}</Text>
				<AppIcon
					size={16}
					className="text-text-subtle"
					name={isExpanded ? "chevron-up" : "chevron-down"}
				/>
			</Pressable>
			{isExpanded ? (
				<View className="gap-1 pb-3">
					{entries.length === 0 ? (
						<Text className="font-ui text-xs text-text-subtle">No extra detail was recorded.</Text>
					) : (
						entries.map((entry) => (
							<View key={entry.key} className="flex-row gap-2">
								<Text className="w-32 font-mono text-[11px] text-text-subtle">{entry.key}</Text>
								<Text className="min-w-0 flex-1 font-mono text-[11px] text-text-muted">
									{entry.value}
								</Text>
							</View>
						))
					)}
				</View>
			) : null}
		</View>
	);
}

function RunFailures(props: {
	readonly runId: string;
	readonly hasMore: boolean;
	readonly sourceName: string;
	readonly isLoadingMore: boolean;
	readonly onShowMore: () => void;
	readonly onCopy: (text: string) => void;
	readonly failures: readonly ImportRunFailure[];
}) {
	const [isCopied, setIsCopied] = useState(false);
	const groups = groupImportFailuresByStage(props.failures);

	function copy() {
		props.onCopy(
			buildImportFailureClipboardText({
				runId: props.runId,
				failures: props.failures,
				sourceName: props.sourceName,
			}),
		);
		setIsCopied(true);
	}

	return (
		<View className="gap-5">
			<View className="flex-row items-center justify-between gap-3">
				<Text className="font-ui-semibold text-base text-text">What could not be brought over</Text>
				<AppButton
					onPress={copy}
					accessibilityLabel="Copy details"
					label={isCopied ? "Copied" : "Copy details"}
					leading={<AppIcon size={15} name="copy" className="text-text-muted" />}
				/>
			</View>
			{groups.map((group) => (
				<View key={group.stage} className="gap-1">
					<Text className="font-ui-medium text-sm text-text-muted">{group.heading}</Text>
					<View>
						{group.failures.map((failure) => (
							<FailureRow key={failure.id} failure={failure} pill={group.pill} />
						))}
					</View>
				</View>
			))}
			{props.hasMore ? (
				<Pressable
					onPress={props.onShowMore}
					accessibilityRole="button"
					disabled={props.isLoadingMore}
					accessibilityLabel="Show more failures"
					accessibilityState={{ disabled: props.isLoadingMore }}
					className={clsx("self-start py-2", props.isLoadingMore && "opacity-50")}
				>
					<Text className="font-ui-medium text-sm text-accent-text">
						{props.isLoadingMore ? "Loading more failures..." : "Show more failures"}
					</Text>
				</Pressable>
			) : null}
		</View>
	);
}

export function ImportRunView(props: {
	readonly nowMs: number;
	readonly onRetry: () => void;
	readonly isLoadingMore: boolean;
	readonly onShowMore: () => void;
	readonly state: ImportRunDetailState;
	readonly onCopy: (text: string) => void;
	readonly sourceNames: ReadonlyMap<string, string>;
}) {
	if (props.state.status === "loading") {
		return (
			<AppStatusState
				className="py-16"
				detail="Loading this import..."
				icon={<ActivityIndicator accessibilityLabel="Loading import" />}
			/>
		);
	}
	if (props.state.status === "not-found") {
		return (
			<AppStatusState
				className="py-16"
				title="Import not found"
				detail="This import is no longer on your server."
			/>
		);
	}
	if (props.state.status === "malformed" || props.state.status === "transport-error") {
		const error = importRunDetailError(props.state);
		return (
			<AppStatusState
				detailTone="danger"
				title={error.title}
				detail={error.detail}
				className="rounded-xl border border-border bg-surface p-6"
				action={<AppButton label="Try again" onPress={props.onRetry} />}
			/>
		);
	}
	const run = props.state.run;
	const provenance = importRunProvenanceLabel(run.inputSummary);
	const sourceName = importSourceName(run.source, props.sourceNames);
	return (
		<View className="gap-6 pb-4">
			<RunHeading
				run={run}
				sourceName={sourceName}
				duration={importRunDurationLabel(run, props.nowMs)}
			/>
			{provenance === undefined ? null : (
				<Text numberOfLines={2} className="font-ui text-sm text-text-muted">
					{provenance}
				</Text>
			)}
			<RunCounts run={run} />
			{run.status === "running" || run.status === "pending" ? (
				<Text className="font-ui text-xs text-text-muted">
					This runs on your server and can't be stopped once started.
				</Text>
			) : null}
			{run.status === "failed" ? (
				<View className="flex-row gap-3 rounded-xl border border-border bg-surface p-4">
					<AppIcon size={18} name="circle-alert" className="text-danger" />
					<View className="min-w-0 flex-1 gap-0.5">
						<Text className="font-ui-medium text-sm text-danger">
							{importRunFailureNotice(run.errorSummary).label}
						</Text>
						<Text className="font-ui text-sm leading-5 text-text-muted">
							{importRunFailureNotice(run.errorSummary).detail}
						</Text>
					</View>
				</View>
			) : null}
			{props.state.failures.length === 0 ? null : (
				<RunFailures
					runId={run.id}
					onCopy={props.onCopy}
					sourceName={sourceName}
					onShowMore={props.onShowMore}
					failures={props.state.failures}
					isLoadingMore={props.isLoadingMore}
					hasMore={props.state.hasMoreFailures}
				/>
			)}
		</View>
	);
}
