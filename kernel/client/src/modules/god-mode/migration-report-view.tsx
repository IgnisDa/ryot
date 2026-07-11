import { Button } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import clsx from "clsx";
import { Exit } from "effect";
import { useEffect, useEffectEvent, useState } from "react";

import { isUnauthorizedCause } from "#/modules/god-mode/errors";
import {
	formatMigrationReportElapsed,
	migrationReportLevelPresentation,
} from "#/modules/god-mode/migration-report";
import type { GodModeMigrationReport } from "#/modules/god-mode/service";

type MigrationReportEntry = GodModeMigrationReport["entries"][number];

type MigrationReportState =
	| { readonly kind: "loading" }
	| { readonly kind: "failure" }
	| { readonly kind: "unauthorized" }
	| { readonly kind: "success"; readonly entries: ReadonlyArray<MigrationReportEntry> };

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "short",
	year: "numeric",
	hour: "numeric",
	minute: "2-digit",
	second: "2-digit",
});

const formatMigrationReportTime = (value: string) => dateTimeFormatter.format(new Date(value));

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
					{props.entries.map((entry) => {
						const level = migrationReportLevelPresentation(entry.level);
						return (
							<tr key={entry.seq} className="border-b border-border last:border-b-0">
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
								<td className="px-2 py-3 leading-5 text-text">{entry.message}</td>
								<td className="px-2 py-3 tabular-nums text-text-muted">
									{entry.count?.toLocaleString() ?? "-"}
								</td>
								<td className="px-2 py-3 tabular-nums text-text-muted">
									{formatMigrationReportElapsed(entry.elapsedSeconds)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

export function MigrationReportView(props: {
	readonly unauthorized: () => void;
	readonly load: (signal: AbortSignal) => Promise<Exit.Exit<GodModeMigrationReport, unknown>>;
}) {
	const [attempt, setAttempt] = useState(0);
	const [state, setState] = useState<MigrationReportState>({ kind: "loading" });
	const load = useEffectEvent(async (signal: AbortSignal) => {
		const result = await props.load(signal);
		if (signal.aborted) {
			return;
		}
		if (Exit.isSuccess(result)) {
			setState({ kind: "success", entries: result.value.entries });
			return;
		}
		if (isUnauthorizedCause(result.cause)) {
			setState({ kind: "unauthorized" });
			props.unauthorized();
			return;
		}
		setState({ kind: "failure" });
	});

	useEffect(() => {
		const controller = new AbortController();
		setState({ kind: "loading" });
		void load(controller.signal);
		return () => controller.abort();
	}, [attempt]);

	let content;
	if (state.kind === "unauthorized") {
		return null;
	}
	if (state.kind === "loading") {
		content = (
			<p role="status" className="py-12 text-center text-sm text-text-muted">
				Loading migration report...
			</p>
		);
	} else if (state.kind === "failure") {
		content = (
			<div className="grid justify-items-center gap-4 py-10 text-center">
				<p role="alert" className="text-sm text-danger">
					Could not load the migration report. Check the server and try again.
				</p>
				<Button type="button" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
					Retry
				</Button>
			</div>
		);
	} else if (state.entries.length === 0) {
		content = (
			<div className="grid justify-items-center gap-2 py-12 text-center">
				<AppIcon size={36} name="clipboard-list" className="text-text-subtle" />
				<h2 className="font-display text-lg font-semibold">No migration report</h2>
				<p className="text-sm text-text-muted">This server has no legacy migration activity.</p>
			</div>
		);
	} else {
		content = <MigrationReportTable entries={state.entries} />;
	}

	return (
		<section aria-labelledby="migration-report-title" className="ui-card w-full overflow-hidden">
			<p className="ui-overline">Administration</p>
			<h1 id="migration-report-title" className="font-display text-3xl font-semibold">
				Migration report
			</h1>
			<p className="ui-subtitle mb-5">Legacy migration activity reported by this server.</p>
			{content}
		</section>
	);
}
