import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { createColumnHelper, metaHelper, tableFeatures, useTable } from "@tanstack/react-table";
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
import { AppTableHeader, type AppTableColumnMeta } from "@/modules/ui/table";

const features = tableFeatures({ columnMeta: metaHelper<AppTableColumnMeta>() });
const columnHelper = createColumnHelper<typeof features, MigrationReportEntry>();

const columns = columnHelper.columns([
	columnHelper.accessor("createdAt", {
		header: "Time",
		meta: { className: "w-44" },
		cell: (info) => (
			<Text className="font-ui text-xs text-text-muted">
				{formatLocalDateTimeLabel(info.getValue())}
			</Text>
		),
	}),
	columnHelper.accessor("level", {
		header: "Severity",
		meta: { className: "w-28" },
		cell: (info) => {
			const level = migrationReportLevelPresentation(info.getValue());
			return (
				<View className="flex-row items-center gap-1.5">
					<AppIcon name={level.icon} size={13} className={level.tone} />
					<Text className={clsx("font-ui-medium text-xs", level.tone)}>{level.label}</Text>
				</View>
			);
		},
	}),
	columnHelper.accessor("phase", {
		header: "Phase",
		meta: { className: "w-52" },
		cell: (info) => (
			<Text className="font-ui text-xs text-text" selectable>
				{info.getValue()}
			</Text>
		),
	}),
	columnHelper.accessor("message", {
		header: "Message",
		meta: { className: "min-w-72 flex-1" },
		cell: (info) => (
			<Text className="font-ui text-xs leading-5 text-text" selectable>
				{info.getValue()}
			</Text>
		),
	}),
	columnHelper.accessor("count", {
		header: "Count",
		meta: { className: "w-20" },
		cell: (info) => (
			<Text className="font-ui text-xs tabular-nums text-text-muted">
				{info.getValue()?.toLocaleString() ?? "-"}
			</Text>
		),
	}),
	columnHelper.accessor("elapsedSeconds", {
		header: "Elapsed",
		meta: { className: "w-20" },
		cell: (info) => (
			<Text className="font-ui text-xs tabular-nums text-text-muted">
				{formatMigrationReportElapsed(info.getValue())}
			</Text>
		),
	}),
]);

function MigrationReportTableContent(props: {
	readonly entries: ReadonlyArray<MigrationReportEntry>;
}) {
	const table = useTable({
		columns,
		features,
		data: props.entries,
		getRowId: (entry) => String(entry.seq),
	});

	return (
		<ScrollView horizontal contentContainerClassName="min-w-full">
			<View className="min-w-225 flex-1">
				<AppTableHeader table={table} />
				{table.getRowModel().rows.map((row) => (
					<View
						key={row.id}
						className="min-h-12 flex-row items-center gap-3 border-b border-border py-2 md:gap-4"
					>
						{row.getAllCells().map((cell) => (
							<View key={cell.id} className={cell.column.columnDef.meta?.className}>
								<table.FlexRender cell={cell} />
							</View>
						))}
					</View>
				))}
			</View>
		</ScrollView>
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

	return <MigrationReportTableContent entries={report.value.entries} />;
}
