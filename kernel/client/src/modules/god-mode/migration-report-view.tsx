import { Button } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import clsx from "clsx";
import { Exit } from "effect";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { isUnauthorizedCause } from "#/modules/god-mode/errors";
import {
	buildMigrationReportClipboardText,
	formatMigrationReportElapsed,
	migrationReportDetailLabel,
	migrationReportDetailProvenance,
	migrationReportDetailSentence,
	migrationReportLevelPresentation,
	migrationReportRecordsDetail,
} from "#/modules/god-mode/migration-report";
import { transferMigrationReportDetails } from "#/modules/god-mode/reset-link-transfer";
import type { GodModeMigrationReport } from "#/modules/god-mode/service";

type MigrationReportEntry = GodModeMigrationReport["items"][number];

type ReportPage =
	| { readonly after: string | undefined; readonly state: "loading" | "failure" }
	| {
			readonly after: string | undefined;
			readonly state: "success";
			readonly value: GodModeMigrationReport;
	  };

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
				<div
					className="flex flex-col gap-1"
					key={
						detail.code === "integration-cache-provider-unmapped" ||
						detail.code === "integration-cache-entity-unresolved"
							? detail.legacyCacheId
							: detail.legacyRecordId
					}
				>
					<span className="text-xs font-medium text-text">
						{migrationReportDetailLabel(detail)}
					</span>
					<span className="text-xs leading-5 text-text-muted">
						{migrationReportDetailSentence(detail)}
					</span>
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
			{migrationReportRecordsDetail(code) ? null : (
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
						void transferMigrationReportDetails(
							buildMigrationReportClipboardText({
								code,
								details,
								phase: entry.phase,
								message: entry.message,
								totalDetails: entry.totalDetails,
							}),
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
		signal: AbortSignal,
	) => Promise<Exit.Exit<GodModeMigrationReport, unknown>>;
}) {
	const controller = useRef<AbortController>(null);
	const [unauthorized, setUnauthorized] = useState(false);
	const [pages, setPages] = useState<ReadonlyArray<ReportPage>>([
		{ after: undefined, state: "loading" },
	]);
	const load = useEffectEvent(async (after: string | undefined, signal: AbortSignal) => {
		const result = await props.load(after, signal);
		if (signal.aborted) {
			return;
		}
		if (Exit.isFailure(result) && isUnauthorizedCause(result.cause)) {
			setUnauthorized(true);
			props.unauthorized();
			return;
		}
		setPages((current) =>
			current.map((page) => {
				if (page.after !== after) {
					return page;
				}
				return Exit.isSuccess(result)
					? { after, state: "success", value: result.value }
					: { after, state: "failure" };
			}),
		);
	});

	useEffect(() => {
		const initial = new AbortController();
		controller.current = initial;
		void load(undefined, initial.signal);
		return () => controller.current?.abort();
	}, []);

	const request = (after: string | undefined) => {
		const next = new AbortController();
		controller.current = next;
		void load(after, next.signal);
	};
	const retry = (after: string | undefined) => {
		setPages((current) =>
			current.map((page) => (page.after === after ? { after, state: "loading" } : page)),
		);
		request(after);
	};
	const last = pages.at(-1);
	const loadMore = () => {
		if (last?.state !== "success" || last.value.pageInfo.nextCursor === null) {
			return;
		}
		const after = last.value.pageInfo.nextCursor;
		setPages((current) => [...current, { after, state: "loading" }]);
		request(after);
	};
	const entries = pages.flatMap((page) => (page.state === "success" ? page.value.items : []));

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
			{entries.length === 0 && pages[0]?.state === "success" && (
				<div className="grid justify-items-center gap-2 py-12 text-center">
					<AppIcon size={36} name="clipboard-list" className="text-text-subtle" />
					<h2 className="font-display text-lg font-semibold">No migration report</h2>
					<p className="text-sm text-text-muted">This server has no legacy migration activity.</p>
				</div>
			)}
			{last?.state === "loading" && (
				<p role="status" className="py-12 text-center text-sm text-text-muted">
					Loading migration report...
				</p>
			)}
			{last?.state === "failure" && (
				<div className="grid justify-items-center gap-4 py-10 text-center">
					<p role="alert" className="text-sm text-danger">
						Could not load the migration report. Check the server and try again.
					</p>
					<Button type="button" variant="secondary" onClick={() => retry(last.after)}>
						Retry
					</Button>
				</div>
			)}
			{last?.state === "success" && last.value.pageInfo.nextCursor !== null && (
				<div className="mt-5 flex justify-center">
					<Button type="button" onClick={loadMore} variant="secondary">
						Load more reports
					</Button>
				</div>
			)}
		</section>
	);
}
