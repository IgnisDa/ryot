import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import type { AutomationHistoryRun } from "@ryot-app/contract/modules/automations/history-schemas";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";

import { AutomationStatusGlyph, AutomationStatusPill } from "#/modules/automation-history/status";
import { LoadErrorState } from "#/modules/ui/load-error-state";
import { formatRelativeTime } from "#/modules/ui/run/run-status";
import { StatusState } from "#/modules/ui/status-state";

export type AutomationHistoryListState =
	| { readonly status: "loading" }
	| { readonly status: "failed" }
	| { readonly status: "empty" }
	| {
			readonly status: "ready";
			readonly runs: readonly AutomationHistoryRun[];
			readonly nextCursor: string | null;
	  };

type AutomationHistoryViewProps = {
	readonly nowMs: number;
	readonly state: AutomationHistoryListState;
	readonly onRetry: () => void;
	readonly onShowOlder: () => void;
	readonly isLoadingOlder: boolean;
	readonly olderLoadFailed: boolean;
};

const sourceLabel = (run: AutomationHistoryRun) => run.pluginName ?? "Kernel";

const attemptLabel = (count: number) => `${count} ${count === 1 ? "attempt" : "attempts"}`;

function AutomationHistoryRow(props: {
	readonly run: AutomationHistoryRun;
	readonly nowMs: number;
	readonly isFirst: boolean;
}) {
	const relative = formatRelativeTime(props.run.queuedAt, props.nowMs);
	return (
		<Link
			params={{ runId: props.run.id }}
			to="/settings/automation-history/$runId"
			aria-label={`Open ${props.run.hookName} run from ${relative}`}
			className={clsx(
				"flex items-center gap-3 border-b border-border py-3",
				props.isFirst && "border-t",
			)}
		>
			<AutomationStatusGlyph status={props.run.status} />
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate text-sm font-medium text-text">{props.run.hookName}</span>
				<span className="truncate text-xs text-text-subtle">
					{sourceLabel(props.run)} · {relative}
				</span>
				<span className="text-xs tabular-nums text-text-muted sm:hidden">
					{attemptLabel(props.run.attemptCount)}
				</span>
			</span>
			<span className="hidden text-xs tabular-nums text-text-muted sm:block">
				{attemptLabel(props.run.attemptCount)}
			</span>
			<AutomationStatusPill status={props.run.status} />
			<AppIcon size={16} name="chevron-right" className="shrink-0 text-text-subtle" />
		</Link>
	);
}

export function AutomationHistoryView(props: AutomationHistoryViewProps) {
	if (props.state.status === "failed") {
		return (
			<LoadErrorState
				onRetry={props.onRetry}
				title="Unable to load automation history"
				detail="Your automation runs could not be loaded. Check the server and try again."
			/>
		);
	}
	if (props.state.status === "loading") {
		return <StatusState className="py-16" detail="Loading your automation history..." />;
	}
	if (props.state.status === "empty") {
		return (
			<StatusState
				className="py-12"
				title="No automation runs yet"
				icon={<AppIcon size={40} name="clock" className="text-text-subtle" />}
				detail="Runs will appear here after installed hooks respond to activity in your account."
			/>
		);
	}
	return (
		<div className="flex flex-col gap-6 pb-4">
			<p className="text-sm leading-6 text-text-muted">
				Review recent hook runs and the bounded diagnostics retained by your server.
			</p>
			<div className="flex flex-col gap-2">
				<span className="text-[11px] font-medium uppercase tracking-[0.8px] text-text-subtle">
					Recent
				</span>
				<div>
					{props.state.runs.map((run, index) => (
						<AutomationHistoryRow
							run={run}
							key={run.id}
							nowMs={props.nowMs}
							isFirst={index === 0}
						/>
					))}
				</div>
				{props.olderLoadFailed ? (
					<StatusMessage tone="error" className="text-sm">
						Older runs could not be loaded. Try again.
					</StatusMessage>
				) : null}
				{props.state.nextCursor === null ? null : (
					<Button
						type="button"
						variant="text"
						onClick={props.onShowOlder}
						disabled={props.isLoadingOlder}
						className="self-start text-sm text-accent-text"
					>
						{props.isLoadingOlder ? "Loading older runs..." : "Show older runs"}
					</Button>
				)}
			</div>
		</div>
	);
}
