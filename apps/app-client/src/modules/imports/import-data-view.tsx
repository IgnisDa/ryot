import type { ImportRunSummary } from "@ryot/ryotql-recipes/import-runs";
import clsx from "clsx";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { AppButton } from "@/modules/ui/button";
import { AppStatusState } from "@/modules/ui/status-state";

import { ImportProgressBar } from "./import-progress-bar";
import { ImportStatusGlyph, ImportStatusPill } from "./import-status-pill";
import {
	formatImportRelativeTime,
	importRunCountsLabel,
	importRunDurationLabel,
	importRunOutcomeLabel,
	importRunProgress,
	importRunProgressValue,
	importRunStartedLabel,
	importSourceName,
	liveImportRun,
} from "./run-presentation";
import { importRunListError, type ImportRunListState } from "./state";

const INTRO =
	"Bring your history over from another service. Files are uploaded to your own server, read once, and deleted when the import finishes.";

type SourceNames = ReadonlyMap<string, string>;

function LiveImportRunCard(props: {
	readonly nowMs: number;
	readonly sourceName: string;
	readonly onPress: () => void;
	readonly run: ImportRunSummary;
}) {
	const progress = importRunProgress(props.run);
	return (
		<Pressable
			onPress={props.onPress}
			accessibilityRole="button"
			className="gap-3 rounded-2xl border border-border bg-surface p-4"
			accessibilityLabel={`Open the ${props.sourceName} import in progress`}
		>
			<View className="flex-row items-center justify-between gap-3">
				<Text numberOfLines={1} className="min-w-0 flex-1 font-ui-semibold text-base text-text">
					{props.sourceName}
				</Text>
				<ImportStatusPill status={props.run.status} />
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
			<Text className="font-ui text-xs text-text-subtle">
				{importRunStartedLabel(props.run, props.nowMs)}
			</Text>
			<Text className="font-ui text-xs text-text-muted">
				This keeps running on your server, even if you close Ryot.
			</Text>
		</Pressable>
	);
}

function ImportHistoryRow(props: {
	readonly nowMs: number;
	readonly isFirst: boolean;
	readonly sourceName: string;
	readonly onPress: () => void;
	readonly run: ImportRunSummary;
}) {
	const duration = importRunDurationLabel(props.run, props.nowMs);
	const relative = formatImportRelativeTime(props.run.createdAt, props.nowMs);
	return (
		<Pressable
			onPress={props.onPress}
			accessibilityRole="button"
			accessibilityLabel={`Open the ${props.sourceName} import from ${relative}`}
			className={clsx(
				"flex-row items-center gap-3 border-b border-border py-3",
				props.isFirst && "border-t",
			)}
		>
			<ImportStatusGlyph status={props.run.status} />
			<View className="min-w-0 flex-1 gap-0.5">
				<Text numberOfLines={1} className="font-ui-medium text-sm text-text">
					{props.sourceName}
				</Text>
				<Text numberOfLines={1} className="font-ui text-xs text-text-subtle">
					{duration === undefined ? relative : `${relative} · ${duration}`}
				</Text>
			</View>
			<Text
				numberOfLines={2}
				className="max-w-40 text-right font-ui text-xs tabular-nums text-text-muted"
			>
				{importRunOutcomeLabel(props.run)}
			</Text>
			<AppIcon size={16} name="chevron-right" className="text-text-subtle" />
		</Pressable>
	);
}

function ImportHistory(props: {
	readonly nowMs: number;
	readonly hasMore: boolean;
	readonly isLoadingOlder: boolean;
	readonly onShowOlder: () => void;
	readonly sourceNames: SourceNames;
	readonly runs: readonly ImportRunSummary[];
	readonly onOpenRun: (runId: string) => void;
}) {
	return (
		<View className="gap-2">
			<Text className="font-ui-medium text-[11px] uppercase tracking-[0.8px] text-text-subtle">
				Recent
			</Text>
			<View>
				{props.runs.map((run, index) => (
					<ImportHistoryRow
						run={run}
						key={run.id}
						nowMs={props.nowMs}
						isFirst={index === 0}
						onPress={() => props.onOpenRun(run.id)}
						sourceName={importSourceName(run.source, props.sourceNames)}
					/>
				))}
			</View>
			{props.hasMore ? (
				<Pressable
					accessibilityRole="button"
					onPress={props.onShowOlder}
					disabled={props.isLoadingOlder}
					accessibilityLabel="Show older imports"
					accessibilityState={{ disabled: props.isLoadingOlder }}
					className={clsx("self-start py-2", props.isLoadingOlder && "opacity-50")}
				>
					<Text className="font-ui-medium text-sm text-accent-text">
						{props.isLoadingOlder ? "Loading older imports..." : "Show older imports"}
					</Text>
				</Pressable>
			) : null}
		</View>
	);
}

export function ImportDataView(props: {
	readonly nowMs: number;
	readonly onRetry: () => void;
	readonly isLoadingOlder: boolean;
	readonly onShowOlder: () => void;
	readonly sourceNames: SourceNames;
	readonly state: ImportRunListState;
	readonly onOpenIntegrations: () => void;
	readonly onOpenRun: (runId: string) => void;
}) {
	if (props.state.status === "loading") {
		return (
			<AppStatusState
				className="py-16"
				detail="Loading your imports..."
				icon={<ActivityIndicator accessibilityLabel="Loading imports" />}
			/>
		);
	}
	if (props.state.status === "malformed" || props.state.status === "transport-error") {
		const error = importRunListError(props.state);
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
	const ready = props.state.status === "ready" ? props.state : undefined;
	const runs = ready?.runs ?? [];
	const live = liveImportRun(runs);
	return (
		<View className="gap-6 pb-4">
			<Text className="font-ui text-sm leading-6 text-text-muted">{INTRO}</Text>
			{live === undefined ? null : (
				<LiveImportRunCard
					run={live}
					nowMs={props.nowMs}
					onPress={() => props.onOpenRun(live.id)}
					sourceName={importSourceName(live.source, props.sourceNames)}
				/>
			)}
			{props.state.status === "empty" ? (
				<AppStatusState
					className="py-12"
					title="No imports yet"
					icon={<AppIcon size={40} name="clipboard-list" className="text-text-subtle" />}
					detail="When you bring history over from another service, every run shows up here with its progress and anything it could not read."
				/>
			) : (
				<ImportHistory
					runs={runs}
					nowMs={props.nowMs}
					onOpenRun={props.onOpenRun}
					sourceNames={props.sourceNames}
					onShowOlder={props.onShowOlder}
					hasMore={ready?.hasMore ?? false}
					isLoadingOlder={props.isLoadingOlder}
				/>
			)}
			<Pressable
				accessibilityRole="link"
				onPress={props.onOpenIntegrations}
				accessibilityLabel="Syncing on a schedule? Integrations"
				className="flex-row items-center gap-1.5 self-start py-1"
			>
				<Text className="font-ui text-sm text-text-muted">Syncing on a schedule?</Text>
				<Text className="font-ui-medium text-sm text-accent-text">Integrations</Text>
				<AppIcon size={14} name="arrow-right" className="text-accent-text" />
			</Pressable>
		</View>
	);
}
