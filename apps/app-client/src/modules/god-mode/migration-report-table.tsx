import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import clsx from "clsx";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useEffectEvent } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { migrationReportAtom, type MigrationReportEntry } from "@/modules/god-mode/atoms";
import { isUnauthorizedCause } from "@/modules/god-mode/errors";
import {
	formatMigrationReportElapsed,
	migrationReportLevelPresentation,
} from "@/modules/god-mode/migration-report";
import { GOD_MODE_INVALID_TOKEN, useGodModeSession } from "@/modules/god-mode/session";
import { AppIcon } from "@/modules/icons";
import { AppButton } from "@/modules/ui/button";
import { formatLocalDateTimeLabel } from "@/modules/ui/date";
import { AppStatusState } from "@/modules/ui/status-state";
import { AppTableHeader } from "@/modules/ui/table-header";

const headers = [
	{ label: "Time", className: "w-44" },
	{ label: "Severity", className: "w-28" },
	{ label: "Phase", className: "w-52" },
	{ label: "Message", className: "min-w-72 flex-1" },
	{ label: "Count", className: "w-20" },
	{ label: "Elapsed", className: "w-20" },
] as const;

function ReportRow(props: { readonly entry: MigrationReportEntry }) {
	const level = migrationReportLevelPresentation(props.entry.level);
	return (
		<View className="min-h-12 flex-row items-center gap-3 border-b border-border py-2 md:gap-4">
			<Text className="w-44 font-ui text-xs text-text-muted">
				{formatLocalDateTimeLabel(props.entry.createdAt)}
			</Text>
			<View className="w-28 flex-row items-center gap-1.5">
				<AppIcon name={level.icon} size={13} className={level.tone} />
				<Text className={clsx("font-ui-medium text-xs", level.tone)}>{level.label}</Text>
			</View>
			<Text className="w-52 font-ui text-xs text-text" selectable>
				{props.entry.phase}
			</Text>
			<Text className="min-w-72 flex-1 font-ui text-xs leading-5 text-text" selectable>
				{props.entry.message}
			</Text>
			<Text className="w-20 font-ui text-xs tabular-nums text-text-muted">
				{props.entry.count?.toLocaleString() ?? "-"}
			</Text>
			<Text className="w-20 font-ui text-xs tabular-nums text-text-muted">
				{formatMigrationReportElapsed(props.entry.elapsedSeconds)}
			</Text>
		</View>
	);
}

export function MigrationReportTable() {
	const { lock, scope } = useGodModeSession();
	const reportAtom = migrationReportAtom(scope);
	const report = useAtomValue(reportAtom);
	const refresh = useAtomRefresh(reportAtom);
	const unauthorized = AsyncResult.isFailure(report) && isUnauthorizedCause(report.cause);
	const escalate = useEffectEvent(() => lock(GOD_MODE_INVALID_TOKEN));

	useEffect(() => {
		if (unauthorized) {
			escalate();
		}
	}, [unauthorized]);

	if (unauthorized) {
		return null;
	}

	if (AsyncResult.isFailure(report)) {
		return (
			<AppStatusState
				className="py-10"
				detailTone="danger"
				action={<AppButton label="Retry" onPress={refresh} />}
				detail="Could not load the migration report. Check the server and try again."
			/>
		);
	}

	if (!AsyncResult.isSuccess(report)) {
		return (
			<AppStatusState
				className="py-12"
				detail="Loading migration report..."
				icon={<ActivityIndicator accessibilityLabel="Loading migration report" />}
			/>
		);
	}

	if (report.value.entries.length === 0) {
		return (
			<AppStatusState
				className="py-12"
				title="No migration report"
				detail="This server has no legacy migration activity."
				icon={<AppIcon className="text-text-subtle" name="clipboard-list" size={36} />}
			/>
		);
	}

	return (
		<ScrollView horizontal contentContainerClassName="min-w-full">
			<View className="min-w-225 flex-1">
				<AppTableHeader columns={headers} />
				{report.value.entries.map((entry) => (
					<ReportRow key={entry.seq} entry={entry} />
				))}
			</View>
		</ScrollView>
	);
}
