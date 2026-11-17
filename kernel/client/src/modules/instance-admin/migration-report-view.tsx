import type { Formatters } from "@ryot-app/i18n/formatters";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { nextPageCursor, paginationItems, usePagination } from "@ryot-app/plugin-client-sdk/react";
import { Button, LoadMoreButton } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { Effect } from "effect";
import { useState } from "react";

import { shareOrCopy } from "#/modules/device/share";
import { isUnauthorizedCause, withAdminAuthorization } from "#/modules/instance-admin/errors";
import {
	buildMigrationReportClipboardText,
	formatMigrationReportElapsed,
	migrationReportDetailProvenance,
	migrationReportLevelPresentation,
} from "#/modules/instance-admin/migration-report";
import type { InstanceAdminMigrationReport } from "#/modules/instance-admin/service";

type MigrationReportEntry = InstanceAdminMigrationReport["items"][number];

const formatMigrationReportTime = (formatters: Formatters, value: string) =>
	formatters
		.dateTime({
			day: "numeric",
			month: "short",
			year: "numeric",
			hour: "numeric",
			minute: "2-digit",
			second: "2-digit",
		})
		.format(new Date(value));

export function MigrationReportView(props: {
	readonly unauthorized: () => void;
	readonly load: (
		after: string | undefined,
	) => Effect.Effect<InstanceAdminMigrationReport, unknown>;
}) {
	const t = useT();
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
			<p className="ui-overline">{t(kernelMessage("client.settings.section.administration"))}</p>
			<h1 id="migration-report-title" className="font-display text-3xl font-semibold">
				{t(kernelMessage("client.instance-admin.migration-report.title"))}
			</h1>
			<p className="ui-subtitle mb-5">
				{t(kernelMessage("client.instance-admin.migration-report.subtitle"))}
			</p>
			{entries.length > 0 && <MigrationReportTable entries={entries} />}
			{entries.length === 0 && pagination.pages.length > 0 && !pagination.isFetching && (
				<div className="grid justify-items-center gap-2 py-12 text-center">
					<AppIcon size={36} name="clipboard-list" className="text-text-subtle" />
					<h2 className="font-display text-lg font-semibold">
						{t(kernelMessage("client.instance-admin.migration-report.empty-title"))}
					</h2>
					<p className="text-sm text-text-muted">
						{t(kernelMessage("client.instance-admin.migration-report.empty-detail"))}
					</p>
				</div>
			)}
			{pagination.isPending || pagination.isFetchingNextPage ? (
				<p role="status" className="py-12 text-center text-sm text-text-muted">
					{t(kernelMessage("client.instance-admin.migration-report.loading"))}
				</p>
			) : null}
			{pagination.errorOperation !== null && (
				<div className="grid justify-items-center gap-4 py-10 text-center">
					<p role="alert" className="text-sm text-danger">
						{t(kernelMessage("client.instance-admin.migration-report.load-failed"))}
					</p>
					<Button type="button" variant="secondary" onClick={pagination.retry}>
						{t(kernelMessage("common.action.retry"))}
					</Button>
				</div>
			)}
			{pagination.hasNextPage && pagination.errorOperation !== "append" && (
				<div className="mt-5 flex justify-center">
					<LoadMoreButton
						type="button"
						onClick={pagination.fetchNextPage}
						isFetchingNextPage={pagination.isFetchingNextPage}
						disabled={pagination.isFetching && !pagination.isFetchingNextPage}
						label={t(kernelMessage("client.instance-admin.migration-report.load-more"))}
						loadingLabel={t(kernelMessage("client.instance-admin.migration-report.loading-more"))}
					/>
				</div>
			)}
		</section>
	);
}

function MigrationReportTable(props: { readonly entries: ReadonlyArray<MigrationReportEntry> }) {
	const t = useT();
	return (
		<div className="overflow-x-auto">
			<table className="w-full min-w-225 border-collapse text-left text-xs">
				<thead>
					<tr className="border-b border-border text-text-muted">
						<th scope="col" className="w-44 px-2 py-3 font-semibold">
							{t(kernelMessage("client.instance-admin.migration-report.column.time"))}
						</th>
						<th scope="col" className="w-28 px-2 py-3 font-semibold">
							{t(kernelMessage("client.instance-admin.migration-report.column.severity"))}
						</th>
						<th scope="col" className="w-52 px-2 py-3 font-semibold">
							{t(kernelMessage("client.instance-admin.migration-report.column.phase"))}
						</th>
						<th scope="col" className="min-w-72 px-2 py-3 font-semibold">
							{t(kernelMessage("client.instance-admin.migration-report.column.message"))}
						</th>
						<th scope="col" className="w-20 px-2 py-3 font-semibold">
							{t(kernelMessage("client.instance-admin.migration-report.column.count"))}
						</th>
						<th scope="col" className="w-20 px-2 py-3 font-semibold">
							{t(kernelMessage("client.instance-admin.migration-report.column.elapsed"))}
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

function MigrationReportRow(props: { readonly entry: MigrationReportEntry }) {
	const t = useT();
	const formatters = useFormatters();
	const { entry } = props;
	const [isExpanded, setIsExpanded] = useState(false);
	const level = migrationReportLevelPresentation(entry.level);
	const detailsId = `migration-report-details-${entry.seq}`;
	return (
		<>
			<tr className="border-b border-border last:border-b-0">
				<td className="px-2 py-3 whitespace-nowrap text-text-muted">
					{formatMigrationReportTime(formatters, entry.createdAt)}
				</td>
				<td className="px-2 py-3">
					<span className={clsx("flex items-center gap-1.5 font-semibold", level.tone)}>
						<AppIcon size={13} name={level.icon} />
						{t(level.label)}
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
					{entry.count === null ? "-" : formatters.number().format(entry.count)}
				</td>
				<td className="px-2 py-3 tabular-nums text-text-muted">
					{formatMigrationReportElapsed(formatters, entry.elapsedSeconds)}
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

function DetailList(props: { readonly entry: MigrationReportEntry }) {
	const t = useT();
	const { entry } = props;
	const code = entry.code;
	if (code === null) {
		return null;
	}
	const details = entry.details.items.map(({ detail }) => detail);
	const remaining = (entry.totalDetails ?? details.length) - details.length;
	return (
		<div className="grid gap-3 p-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<span className="text-xs text-text-subtle">
					{details.length === 0
						? t(kernelMessage("client.instance-admin.migration-report.no-detail"))
						: remaining > 0 &&
							t(
								kernelMessage("client.instance-admin.migration-report.more-detail", {
									count: remaining,
								}),
							)}
				</span>
				<Button
					size="sm"
					type="button"
					variant="secondary"
					onClick={() =>
						Effect.runFork(
							shareOrCopy({
								text: buildMigrationReportClipboardText(t, {
									code,
									details,
									phase: entry.phase,
									message: entry.message,
									totalDetails: entry.totalDetails,
								}),
							}),
						)
					}
				>
					<AppIcon size={14} name="copy" />
					{t(kernelMessage("client.instance-admin.migration-report.copy-details"))}
				</Button>
			</div>
			{details.length > 0 && (
				<ul className="grid gap-2">
					{details.map((detail) => (
						<li
							key={detail.key}
							className="grid gap-2 rounded-md border border-border bg-surface px-3 py-2.5"
						>
							<div className="grid gap-0.5">
								<span className="text-xs font-medium text-text">{detail.label}</span>
								<span className="text-xs leading-5 text-text-muted">{detail.sentence}</span>
							</div>
							<dl className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-4 gap-y-2">
								{migrationReportDetailProvenance(detail).map((provenance) => (
									<div key={provenance.key} className="grid min-w-0 gap-0.5">
										<dt className="text-[11px] text-text-subtle">{provenance.key}</dt>
										<dd className="font-mono text-[11px] break-all text-text-muted">
											{provenance.value}
										</dd>
									</div>
								))}
							</dl>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
