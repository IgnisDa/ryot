import clsx from "clsx";
import type { ReactNode } from "react";

import { ProgressBar } from "./progress-bar";

export type ArtTileAspect = "poster" | "square";

const aspectClasses = { poster: "aspect-2/3", square: "aspect-square" } as const;

export function ArtTile(props: {
	readonly art: ReactNode;
	readonly title: ReactNode;
	readonly aspect: ArtTileAspect;
	readonly badge?: ReactNode;
	readonly className?: string;
	readonly lines?: readonly string[];
	readonly progress?: { readonly value: number; readonly max: number; readonly label: string };
}) {
	return (
		<div className={clsx("group/tile flex min-w-0 flex-col gap-2", props.className)}>
			<div
				className={clsx(
					"relative overflow-hidden rounded-lg bg-surface-2 shadow-sm transition-transform duration-150 group-hover/tile:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover/tile:translate-y-0",
					aspectClasses[props.aspect],
				)}
			>
				<div className="absolute inset-0 [&>*]:size-full">{props.art}</div>
				{props.badge === undefined ? null : (
					<span className="absolute top-1.5 left-1.5 rounded-pill bg-raised/90 px-2 py-0.5 text-micro font-semibold text-text shadow-sm">
						{props.badge}
					</span>
				)}
				{props.progress === undefined ? null : (
					<ProgressBar
						track="art"
						tone="accent"
						max={props.progress.max}
						label={props.progress.label}
						value={props.progress.value}
						className="absolute inset-x-2 bottom-2"
					/>
				)}
			</div>
			<div className="grid gap-0.5">
				<p className="line-clamp-2 text-label font-medium text-text">{props.title}</p>
				{(props.lines ?? []).map((line) => (
					<p key={line} className="line-clamp-1 text-xs text-text-muted">
						{line}
					</p>
				))}
			</div>
		</div>
	);
}
