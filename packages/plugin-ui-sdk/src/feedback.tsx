import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

const noticeTones = {
	info: { icon: "text-info", box: "bg-info-soft" },
	danger: { icon: "text-danger", box: "bg-danger-soft" },
	success: { icon: "text-success", box: "bg-success-soft" },
	warning: { icon: "text-warning", box: "bg-warning-soft" },
} as const;

export function Notice(props: {
	readonly icon?: ReactNode;
	readonly title?: ReactNode;
	readonly action?: ReactNode;
	readonly className?: string;
	readonly children?: ReactNode;
	readonly tone: keyof typeof noticeTones;
}) {
	const tone = noticeTones[props.tone];
	return (
		<div
			role={props.tone === "danger" ? "alert" : "status"}
			className={clsx(
				"flex items-start gap-2.5 rounded-md px-3 py-2.5 text-label text-text",
				tone.box,
				props.className,
			)}
		>
			{props.icon !== undefined && (
				<span aria-hidden="true" className={clsx("mt-px shrink-0", tone.icon)}>
					{props.icon}
				</span>
			)}
			<div className="min-w-0 flex-1">
				{props.title !== undefined && <p className="font-semibold">{props.title}</p>}
				{props.children}
			</div>
			{props.action}
		</div>
	);
}

export function EmptyState(props: {
	readonly title: string;
	readonly icon?: ReactNode;
	readonly action?: ReactNode;
	readonly className?: string;
	readonly description?: ReactNode;
}) {
	return (
		<div
			className={clsx("grid justify-items-center gap-1.5 px-4 py-10 text-center", props.className)}
		>
			{props.icon !== undefined && (
				<span
					aria-hidden="true"
					className="mb-1.5 flex size-10 items-center justify-center rounded-full bg-surface-2 text-text-muted"
				>
					{props.icon}
				</span>
			)}
			<p className="text-body font-semibold text-text">{props.title}</p>
			{props.description !== undefined && (
				<p className="max-w-[44ch] text-label text-text-muted">{props.description}</p>
			)}
			{props.action !== undefined && <div className="mt-3">{props.action}</div>}
		</div>
	);
}

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			aria-hidden="true"
			className={clsx(
				"animate-pulse rounded-sm bg-surface-2 motion-reduce:animate-none",
				className,
			)}
			{...props}
		/>
	);
}
