import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { type RyotQueryResult, useRyot } from "@ryot-app/plugin-client-sdk/react";
import { Button, ProgressBar, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { MarkdownContent } from "@ryot-app/plugin-ui-sdk/markdown";
import { SyncCountLine } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import { type ReactNode, useState } from "react";

import type { MediaSummaryFact } from "./summary-state";
import type { MediaSyncCounts } from "./sync-counts";

export function MediaRefreshStatus(props: { readonly result: RyotQueryResult<unknown> }) {
	if (props.result.status !== "error" || props.result.data === undefined) {
		return null;
	}
	return (
		<StatusMessage
			tone="pending"
			className="py-2 font-ui text-[12px]"
			action={{ label: "Try again", onClick: props.result.refetch }}
		>
			Refresh failed. Showing last loaded content.
		</StatusMessage>
	);
}

export function MediaFact(props: {
	readonly label: string;
	readonly value: string;
	readonly suffix?: string | undefined;
}) {
	return (
		<div className="min-w-20">
			<p className="text-sm font-semibold text-text tabular-nums">
				{props.value}
				{props.suffix === undefined ? null : (
					<span className="text-xs font-normal text-text-muted">{props.suffix}</span>
				)}
			</p>
			<p className="text-xs text-text-muted">{props.label}</p>
		</div>
	);
}

export function MediaFactDivider() {
	return <div className="h-9 w-px bg-border" />;
}

export function MediaFactRow(props: {
	readonly compact: boolean;
	readonly facts: readonly MediaSummaryFact[];
}) {
	const { compact } = props;
	return (
		<div
			className={clsx(
				"flex flex-wrap items-center gap-y-4 pt-0.5",
				!compact && "flex-nowrap gap-x-4",
			)}
		>
			{props.facts.map((fact, index) => (
				<div
					key={fact.label}
					className={clsx("flex items-center gap-3", compact ? "w-1/2" : "w-auto flex-none")}
				>
					{index === 0 || (compact && index % 2 === 0) ? null : (
						<div className={clsx("flex", compact ? "mr-3" : "mr-4")}>
							<MediaFactDivider />
						</div>
					)}
					{compact && (
						<div className="flex w-5 items-center">
							<AppIcon
								size={18}
								name={fact.icon}
								className={fact.iconClass ?? "text-text-subtle"}
							/>
						</div>
					)}
					<MediaFact label={fact.label} value={fact.value} suffix={fact.suffix} />
				</div>
			))}
		</div>
	);
}

export function MediaProgressBar(props: { readonly percent: number }) {
	return (
		<ProgressBar
			max={100}
			tone="success"
			label="Progress"
			className="max-w-md"
			value={props.percent}
		/>
	);
}

export function MediaLabeledRows(props: {
	readonly rows: readonly {
		readonly key: string;
		readonly title: string;
		readonly detail?: string | undefined;
	}[];
}) {
	return (
		<div className="flex flex-col gap-2.5">
			{props.rows.map((row) => (
				<div key={row.key} className="flex flex-col">
					<p className="font-ui font-medium text-[13px] leading-4.5 text-text">{row.title}</p>
					{row.detail === undefined || row.detail === "" ? null : (
						<p className="font-ui text-[11px] leading-3.75 text-text-subtle">{row.detail}</p>
					)}
				</div>
			))}
		</div>
	);
}

export function MediaRail(props: { readonly compact: boolean; readonly children: ReactNode }) {
	return (
		<div className="overflow-x-auto">
			<div className={clsx("flex w-max", props.compact ? "gap-3" : "gap-4")}>{props.children}</div>
		</div>
	);
}

export function MediaOverviewSection(props: {
	readonly title: string;
	readonly action?: ReactNode;
	readonly children: ReactNode;
	readonly className?: string | undefined;
	readonly sync?: MediaSyncCounts | undefined;
}) {
	return (
		<section className={clsx("grid gap-3", props.className)}>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 items-baseline gap-3">
					<h2 className="text-heading font-semibold text-text">{props.title}</h2>
					{props.sync === undefined ? null : (
						<span className="text-xs text-text-muted">
							<SyncCountLine
								populating={props.sync.populating}
								translating={props.sync.translating}
							/>
						</span>
					)}
				</div>
				{props.action}
			</div>
			{props.children}
		</section>
	);
}

export function useMediaOpenLink() {
	const client = useRyot();
	const [error, setError] = useState<string | null>(null);
	return {
		error,
		openLink: (url: string) => {
			setError(null);
			void Effect.runPromise(client.links.open({ url })).catch(() => {
				setError("Unable to open link. Try again.");
			});
		},
	};
}

export function MediaMarkdown(props: { readonly text: string }) {
	const { error, openLink } = useMediaOpenLink();
	return (
		<>
			<MarkdownContent text={props.text} onOpenLink={openLink} />
			{error === null ? null : (
				<p role="alert" className="text-[13px] text-text-muted">
					{error}
				</p>
			)}
		</>
	);
}

export function MediaExternalLink(props: { readonly href: string; readonly label: string }) {
	const { error, openLink } = useMediaOpenLink();
	return (
		<>
			<a
				href={props.href}
				className="font-ui font-medium text-[13px] text-accent-text"
				onClick={(event) => {
					event.preventDefault();
					openLink(props.href);
				}}
				onAuxClick={(event) => {
					event.preventDefault();
					if (event.button === 1) {
						openLink(props.href);
					}
				}}
			>
				{props.label}
			</a>
			{error === null ? null : (
				<span role="alert" className="font-ui text-[13px] text-text-muted">
					{error}
				</span>
			)}
		</>
	);
}

export function MediaStatusMessage(props: {
	readonly title: string;
	readonly detail: string;
	readonly onRetry?: () => void;
}) {
	return (
		<div className="flex min-h-96 flex-col items-center justify-center gap-3 px-6">
			<p className="text-center font-ui font-medium text-base text-text">{props.title}</p>
			<p className="max-w-xl text-center font-ui text-sm text-text-muted">{props.detail}</p>
			{props.onRetry === undefined ? null : (
				<Button variant="link" onClick={props.onRetry}>
					Try again
				</Button>
			)}
		</div>
	);
}
