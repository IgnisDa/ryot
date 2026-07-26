import type { RyotQueryResult } from "@ryot-app/client-sdk/react";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import clsx from "clsx";
import type { ReactNode } from "react";

export function ShowRefreshStatus(props: { readonly result: RyotQueryResult<unknown> }) {
	if (props.result.status !== "error" || props.result.data === undefined) {
		return null;
	}
	return (
		<div role="status" className="flex items-center gap-3 py-2 font-ui text-[12px] text-text-muted">
			<span>Refresh failed. Showing last loaded content.</span>
			<ShowLinkButton label="Try again" onClick={props.result.refetch} />
		</div>
	);
}

export function ShowChip(props: { readonly label: string }) {
	return (
		<span className="rounded-pill border border-border bg-surface-2 px-2.5 py-1 font-ui text-[12px] text-text-muted">
			{props.label}
		</span>
	);
}

export function ShowFact(props: {
	readonly label: string;
	readonly value: string;
	readonly suffix?: string | undefined;
}) {
	return (
		<div className="min-w-20">
			<p className="font-ui font-semibold text-[15px] text-text">
				{props.value}
				{props.suffix === undefined ? null : (
					<span className="font-ui text-[13px]">{props.suffix}</span>
				)}
			</p>
			<p className="font-ui text-[12px] text-text">{props.label}</p>
		</div>
	);
}

export function ShowFactDivider() {
	return <div className="h-9 w-px bg-border" />;
}

export function ShowProgressBar(props: { readonly percent: number }) {
	return (
		<div className="h-1 max-w-md overflow-hidden rounded-pill bg-surface-2">
			<div className="h-full rounded-pill bg-success" style={{ width: `${props.percent}%` }} />
		</div>
	);
}

export function ShowRailRow(props: {
	readonly icon: string;
	readonly title: string;
	readonly compact: boolean;
	readonly detail?: string;
	readonly divided?: boolean;
	readonly trailing?: ReactNode;
}) {
	return (
		<div
			className={clsx(
				"flex flex-col gap-2.5 px-4 py-3.5",
				props.divided !== false && "border-b border-border",
			)}
		>
			<div className="flex items-center gap-3">
				{props.compact && <AppIcon name={props.icon} size={18} className="text-text-subtle" />}
				<div className="min-w-0 flex-1">
					<p className="font-ui font-medium text-[14px] text-text">{props.title}</p>
					{props.detail === undefined ? null : (
						<p className="font-ui text-[12px] text-text-subtle">{props.detail}</p>
					)}
				</div>
				{props.trailing}
			</div>
		</div>
	);
}

export function ShowOverviewSection(props: {
	readonly title: string;
	readonly compact: boolean;
	readonly divided?: boolean;
	readonly action?: ReactNode;
	readonly children: ReactNode;
	readonly className?: string | undefined;
}) {
	return (
		<section
			className={clsx(props.divided !== false && "border-t border-border pt-5", props.className)}
		>
			<div className="flex items-center justify-between gap-3 pb-4">
				<h2
					className={clsx(
						"font-display font-semibold text-text",
						props.compact ? "text-[17px]" : "text-xl",
					)}
				>
					{props.title}
				</h2>
				{props.action}
			</div>
			{props.children}
		</section>
	);
}

export function ShowLinkButton(props: {
	readonly label: string;
	readonly onClick: () => void;
	readonly tone?: "accent" | "plain";
}) {
	return (
		<button
			type="button"
			onClick={props.onClick}
			className={clsx(
				"font-ui font-medium text-[13px]",
				props.tone === "plain" ? "text-text" : "text-accent-text",
			)}
		>
			{props.label}
		</button>
	);
}

export function ShowActionButton(props: {
	readonly label: string;
	readonly compact: boolean;
	readonly onClick: () => void;
	readonly variant: "primary" | "secondary";
}) {
	const isPrimary = props.variant === "primary";
	return (
		<button
			type="button"
			onClick={props.onClick}
			className={clsx(
				"flex items-center justify-center rounded-md",
				props.compact ? "h-12 flex-1" : "h-8 w-full flex-none",
				isPrimary ? "bg-accent" : "border border-border bg-surface-2",
			)}
		>
			<span
				className={clsx(
					"font-ui font-semibold text-[14px]",
					isPrimary ? "text-accent-ink" : "text-text",
				)}
			>
				{props.label}
			</span>
		</button>
	);
}

export function ShowStatusMessage(props: {
	readonly title: string;
	readonly detail: string;
	readonly onRetry?: () => void;
}) {
	return (
		<div className="flex min-h-96 flex-col items-center justify-center gap-3 px-6">
			<p className="text-center font-ui font-medium text-base text-text">{props.title}</p>
			<p className="max-w-xl text-center font-ui text-sm text-text-muted">{props.detail}</p>
			{props.onRetry === undefined ? null : (
				<ShowLinkButton label="Try again" onClick={props.onRetry} />
			)}
		</div>
	);
}
