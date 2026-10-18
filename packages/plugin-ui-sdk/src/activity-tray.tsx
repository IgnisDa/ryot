import clsx from "clsx";
import type { ReactNode } from "react";

import { Button, IconButton } from "./button";
import { MotionList } from "./motion";

export type ActivityTone = "pending" | "success" | "warning" | "error";

export type ActivityAction = { readonly label: string; readonly onClick: () => void };

export type ActivityTrayEntry = {
	readonly id: string;
	readonly title: string;
	readonly source: string;
	readonly tone: ActivityTone;
	readonly status: string;
	readonly detail?: string | undefined;
	readonly action?: ActivityAction | undefined;
	readonly onDismiss?: (() => void) | undefined;
};

const toneClasses = {
	error: "text-danger",
	success: "text-success",
	warning: "text-warning",
	pending: "text-text-muted",
} as const satisfies Record<ActivityTone, string>;

const markerClasses = {
	error: "bg-danger",
	success: "bg-success",
	warning: "bg-warning",
	pending: "animate-pulse bg-text-subtle motion-reduce:animate-none",
} as const satisfies Record<ActivityTone, string>;

export function Toast(props: {
	readonly entry: ActivityTrayEntry;
	readonly dismissIcon: ReactNode;
}) {
	const { entry } = props;
	return (
		<article
			aria-label={`${entry.source}: ${entry.title}`}
			className="pointer-events-auto flex w-full gap-3 rounded-lg border border-border-card bg-raised p-3 text-sm text-text shadow-card"
		>
			<span
				aria-hidden="true"
				className={clsx("mt-1.5 size-2 shrink-0 rounded-full", markerClasses[entry.tone])}
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<p className="truncate text-micro font-medium tracking-wide text-text-subtle uppercase">
					{entry.source}
				</p>
				<p className="font-medium break-words">{entry.title}</p>
				<p className={toneClasses[entry.tone]}>{entry.status}</p>
				{entry.detail === undefined ? null : (
					<p className="text-label text-text-muted">{entry.detail}</p>
				)}
				{entry.action === undefined ? null : (
					<div className="mt-1.5">
						<Button size="sm" variant="secondary" onClick={entry.action.onClick}>
							{entry.action.label}
						</Button>
					</div>
				)}
			</div>
			{entry.onDismiss === undefined ? null : (
				<IconButton
					size="sm"
					className="-mt-1 -mr-1"
					onClick={entry.onDismiss}
					label={`Dismiss ${entry.title}`}
				>
					{props.dismissIcon}
				</IconButton>
			)}
		</article>
	);
}

export function ActivityTray(props: {
	readonly label: string;
	readonly compact: boolean;
	readonly announcement: string;
	readonly dismissIcon: ReactNode;
	readonly safeAreaBottom: number;
	readonly entries: ReadonlyArray<ActivityTrayEntry>;
}) {
	return (
		<section
			aria-label={props.label}
			style={{ paddingBottom: props.safeAreaBottom + 12 }}
			className={clsx(
				"pointer-events-none fixed z-40 flex flex-col",
				props.compact
					? "inset-x-0 bottom-0 px-3"
					: "right-4 bottom-4 w-90 max-w-[calc(100vw-2rem)]",
			)}
		>
			<p aria-live="polite" aria-atomic="true" className="sr-only">
				{props.announcement}
			</p>
			<MotionList className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
				{props.entries.map((entry) => (
					<Toast entry={entry} key={entry.id} dismissIcon={props.dismissIcon} />
				))}
			</MotionList>
		</section>
	);
}
