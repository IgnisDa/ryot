import { nextPageCursor, paginationItems, usePagination } from "@ryot-app/plugin-client-sdk/react";
import { Button, LoadMoreButton } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { Effect } from "effect";
import { useState } from "react";

import { isUnauthorizedCause, withAdminAuthorization } from "#/modules/instance-admin/errors";
import { transferMigrationReportDetails } from "#/modules/instance-admin/link-transfer";
import {
	buildMigrationReportClipboardText,
	formatMigrationReportElapsed,
	migrationReportDetailProvenance,
	migrationReportLevelPresentation,
} from "#/modules/instance-admin/migration-report";
import type { InstanceAdminMigrationReport } from "#/modules/instance-admin/service";

type MigrationReportEntry = InstanceAdminMigrationReport["items"][number];

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "short",
	year: "numeric",
	hour: "numeric",
	minute: "2-digit",
	second: "2-digit",
});

const formatMigrationReportTime = (value: string) => dateTimeFormatter.format(new Date(value));

function DetailList(props: { readonly entry: MigrationReportEntry }) {
	const { entry } = props;
	const code = entry.code;
	if (code === null) {
		return null;
	}
	const details = entry.details.items.map(({ detail }) => detail);
	const remaining = (entry.totalDetails ?? details.length) - details.length;
	return (
		<div className="flex flex-col gap-3 px-2 pb-3">
			{details.map((detail) => (
				<div key={detail.key} className="flex flex-col gap-1">
					<span className="text-xs font-medium text-text">{detail.label}</span>
					<span className="text-xs leading-5 text-text-muted">{detail.sentence}</span>
					{migrationReportDetailProvenance(detail).map((provenance) => (
						<div key={provenance.key} className="flex gap-2">
							<span className="w-28 font-mono text-[11px] text-text-subtle">{provenance.key}</span>
							<span className="min-w-0 flex-1 font-mono text-[11px] break-all text-text-muted">
								{provenance.value}
							</span>
						</div>
					))}
				</div>
			))}
			{details.length > 0 ? null : (
				<span className="text-xs text-text-subtle">
					Per-record detail is not recorded for this check.
				</span>
			)}
			{remaining > 0 ? (
				<span className="text-xs text-text-subtle">
					...and {remaining.toLocaleString()} more, queryable in migration_report_detail.
				</span>
			) : null}
			<div>
				<Button
					type="button"
					variant="secondary"
					onClick={() =>
						Effect.runFork(
							transferMigrationReportDetails(
								buildMigrationReportClipboardText({
									code,
									details,
									phase: entry.phase,
									message: entry.message,
									totalDetails: entry.totalDetails,
								}),
							),
						)
					}
				>
					Copy details
				</Button>
			</div>
		</div>
	);
}

function MigrationReportRow(props: { readonly entry: MigrationReportEntry }) {
	const { entry } = props;
	const [isExpanded, setIsExpanded] = useState(false);
	const level = migrationReportLevelPresentation(entry.level);
	const detailsId = `migration-report-details-${entry.seq}`;
	return (
		<>
			<tr className="border-b border-border last:border-b-0">
				<td className="px-2 py-3 whitespace-nowrap text-text-muted">
					{formatMigrationReportTime(entry.createdAt)}
				</td>
				<td className="px-2 py-3">
					<span className={clsx("flex items-center gap-1.5 font-semibold", level.tone)}>
						<AppIcon size={13} name={level.icon} />
						{level.label}
					</span>
				</td>
				<td className="px-2 py-3 text-text">{entry.phase}</td>
				<td className="px-2 py-3 leading-5 text-text">
					{entry.code === null ? (
						entry.message
					) : (
						<button
							type="button"
							aria-controls={detailsId}
							aria-expanded={isExpanded}
							className="flex w-full items-start gap-2 text-left"
							onClick={() => setIsExpanded((expanded) => !expanded)}
						>
							<span className="min-w-0 flex-1">{entry.message}</span>
							<AppIcon
								size={14}
								className="mt-0.5 shrink-0 text-text-subtle"
								name={isExpanded ? "chevron-up" : "chevron-down"}
							/>
						</button>
					)}
				</td>
				<td className="px-2 py-3 tabular-nums text-text-muted">
					{entry.count?.toLocaleString() ?? "-"}
				</td>
				<td className="px-2 py-3 tabular-nums text-text-muted">
					{formatMigrationReportElapsed(entry.elapsedSeconds)}
				</td>
			</tr>
			{isExpanded ? (
				<tr id={detailsId} className="border-b border-border last:border-b-0">
					<td colSpan={6} className="bg-surface-2">
						<DetailList entry={entry} />
					</td>
				</tr>
			) : null}
		</>
	);
}

function MigrationReportTable(props: { readonly entries: ReadonlyArray<MigrationReportEntry> }) {
	return (
		<div className="overflow-x-auto">
			<table className="w-full min-w-225 border-collapse text-left text-xs">
				<thead>
					<tr className="border-b border-border text-text-muted">
						<th scope="col" className="w-44 px-2 py-3 font-semibold">
							Time
						</th>
						<th scope="col" className="w-28 px-2 py-3 font-semibold">
							Severity
						</th>
						<th scope="col" className="w-52 px-2 py-3 font-semibold">
							Phase
						</th>
						<th scope="col" className="min-w-72 px-2 py-3 font-semibold">
							Message
						</th>
						<th scope="col" className="w-20 px-2 py-3 font-semibold">
							Count
						</th>
						<th scope="col" className="w-20 px-2 py-3 font-semibold">
							Elapsed
						</th>
					</tr>
				</thead>
				<tbody>
					{props.entries.map((entry) => (
						<MigrationReportRow entry={entry} key={entry.seq} />
					))}
				</tbody>
			</table>
		</div>
	);
}

export function MigrationReportView(props: {
	readonly unauthorized: () => void;
	readonly load: (
		after: string | undefined,
	) => Effect.Effect<InstanceAdminMigrationReport, unknown>;
}) {
	const pagination = usePagination<InstanceAdminMigrationReport, string | undefined>({
		initialPageParam: undefined,
		getNextPageParam: nextPageCursor,
		identity: "instance-admin-migration-report",
		load: (after) => withAdminAuthorization(props.load(after), props.unauthorized),
	});
	const entries = paginationItems(
		pagination.pages,
		(page) => page.items,
		(entry) => String(entry.seq),
	);
	const unauthorized = pagination.cause !== null && isUnauthorizedCause(pagination.cause);

	if (unauthorized) {
		return null;
	}

	return (
		<section aria-labelledby="migration-report-title" className="ui-card w-full overflow-hidden">
			<p className="ui-overline">Administration</p>
			<h1 id="migration-report-title" className="font-display text-3xl font-semibold">
				Migration report
			</h1>
			<p className="ui-subtitle mb-5">Legacy migration activity reported by this server.</p>
			{entries.length > 0 && <MigrationReportTable entries={entries} />}
			{entries.length === 0 && pagination.pages.length > 0 && !pagination.isFetching && (
				<div className="grid justify-items-center gap-2 py-12 text-center">
					<AppIcon size={36} name="clipboard-list" className="text-text-subtle" />
					<h2 className="font-display text-lg font-semibold">No migration report</h2>
					<p className="text-sm text-text-muted">This server has no legacy migration activity.</p>
				</div>
			)}
			{pagination.isPending || pagination.isFetchingNextPage ? (
				<p role="status" className="py-12 text-center text-sm text-text-muted">
					Loading migration report...
				</p>
			) : null}
			{pagination.errorOperation !== null && (
				<div className="grid justify-items-center gap-4 py-10 text-center">
					<p role="alert" className="text-sm text-danger">
						Could not load the migration report. Check the server and try again.
					</p>
					<Button type="button" variant="secondary" onClick={pagination.retry}>
						Retry
					</Button>
				</div>
			)}
			{pagination.hasNextPage && pagination.errorOperation !== "append" && (
				<div className="mt-5 flex justify-center">
					<LoadMoreButton
						type="button"
						label="Load more reports"
						onClick={pagination.fetchNextPage}
						loadingLabel="Loading more reports..."
						isFetchingNextPage={pagination.isFetchingNextPage}
						disabled={pagination.isFetching && !pagination.isFetchingNextPage}
					/>
				</div>
			)}
		</section>
	);
}
