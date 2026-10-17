import clsx from "clsx";
import type { ReactNode } from "react";

export type Stat = {
	readonly key: string;
	readonly label: string;
	readonly value: ReactNode;
	readonly detail?: ReactNode | undefined;
};

export function StatStrip(props: {
	readonly compact: boolean;
	readonly className?: string | undefined;
	readonly stats: readonly Stat[];
}) {
	return (
		<dl
			className={clsx(
				"grid gap-x-6 gap-y-4",
				props.compact ? "grid-cols-2" : "auto-cols-fr grid-flow-col",
				props.className,
			)}
		>
			{props.stats.map((stat) => (
				<div key={stat.key} className="flex min-w-0 flex-col-reverse gap-0.5">
					<dt className="text-label text-text-muted">{stat.label}</dt>
					<dd className="truncate text-metric font-semibold text-text tabular-nums">
						{stat.value}
					</dd>
					{stat.detail === undefined ? null : (
						<dd className="order-first text-micro text-text-subtle">{stat.detail}</dd>
					)}
				</div>
			))}
		</dl>
	);
}
