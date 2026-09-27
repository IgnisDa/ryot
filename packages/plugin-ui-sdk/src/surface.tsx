import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

const cardPadding = { none: "", md: "p-4", lg: "p-5" } as const;

export function Card({
	className,
	padding = "md",
	...props
}: ComponentProps<"div"> & { readonly padding?: keyof typeof cardPadding }) {
	return (
		<div
			className={clsx(
				"rounded-lg border border-border-card bg-surface",
				cardPadding[padding],
				className,
			)}
			{...props}
		/>
	);
}

export function RowGroup({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={clsx(
				"divide-y divide-border overflow-hidden rounded-lg border border-border-card bg-surface",
				className,
			)}
			{...props}
		/>
	);
}

export function Row(props: {
	readonly title: ReactNode;
	readonly leading?: ReactNode;
	readonly trailing?: ReactNode;
	readonly className?: string;
	readonly description?: ReactNode;
}) {
	return (
		<div className={clsx("flex min-h-14 items-center gap-4 px-4 py-3", props.className)}>
			{props.leading}
			<div className="min-w-0 flex-1">
				<div className="text-sm font-medium text-text">{props.title}</div>
				{props.description !== undefined && (
					<div className="text-xs text-text-muted">{props.description}</div>
				)}
			</div>
			{props.trailing}
		</div>
	);
}
