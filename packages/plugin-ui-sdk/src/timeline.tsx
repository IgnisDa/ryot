import clsx from "clsx";
import { type ReactNode, useId } from "react";

import { Button } from "./button";
import { Collapse } from "./motion";

const markerTones = {
	info: { fill: "bg-info", ring: "border-info" },
	accent: { fill: "bg-accent", ring: "border-accent" },
	success: { fill: "bg-success", ring: "border-success" },
	muted: { fill: "bg-border-strong", ring: "border-border-strong" },
} as const;

export type TimelineMarker = {
	readonly tone: keyof typeof markerTones;
	readonly emphasis?: boolean | undefined;
};

export function Timeline(props: {
	readonly children: ReactNode;
	readonly className?: string | undefined;
}) {
	return <div className={clsx("grid gap-6", props.className)}>{props.children}</div>;
}

export function TimelineGroup(props: {
	readonly label: ReactNode;
	readonly compact: boolean;
	readonly children: ReactNode;
}) {
	return (
		<section className={clsx("grid gap-2", !props.compact && "grid-cols-[7rem_minmax(0,1fr)]")}>
			<h3
				className={clsx(
					"text-micro font-medium tracking-wide text-text-subtle uppercase",
					!props.compact && "sticky top-2 self-start pt-0.5",
				)}
			>
				{props.label}
			</h3>
			<ol className="relative before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-border">
				{props.children}
			</ol>
		</section>
	);
}

export function TimelineEntry(props: {
	readonly title: ReactNode;
	readonly marker: TimelineMarker;
	readonly meta?: ReactNode | undefined;
	readonly actions?: ReactNode | undefined;
	readonly children?: ReactNode | undefined;
	readonly expand?:
		| undefined
		| {
				readonly label: string;
				readonly expanded: boolean;
				readonly content: ReactNode;
				readonly onToggle: () => void;
		  };
}) {
	const contentId = useId();
	return (
		<li className="relative grid gap-1 py-1.5 pl-6">
			<span
				aria-hidden="true"
				className={clsx(
					"absolute top-3 left-0 size-[11px] rounded-full ring-3 ring-bg",
					props.marker.emphasis === true
						? clsx("border-2 bg-bg", markerTones[props.marker.tone].ring)
						: markerTones[props.marker.tone].fill,
				)}
			/>
			<div className="flex min-w-0 items-start gap-3">
				<div className="grid min-w-0 flex-1 gap-0.5">
					<p
						className={clsx(
							"text-body text-text",
							props.marker.emphasis === true ? "font-semibold" : "font-medium",
						)}
					>
						{props.title}
					</p>
					{props.meta === undefined ? null : (
						<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
							{props.meta}
						</div>
					)}
				</div>
				{props.actions}
			</div>
			{props.children}
			{props.expand === undefined ? null : (
				<>
					<Button
						variant="link"
						aria-controls={contentId}
						className="justify-self-start"
						onClick={props.expand.onToggle}
						aria-expanded={props.expand.expanded}
					>
						{props.expand.label}
					</Button>
					<div id={contentId}>
						<Collapse open={props.expand.expanded}>{props.expand.content}</Collapse>
					</div>
				</>
			)}
		</li>
	);
}
