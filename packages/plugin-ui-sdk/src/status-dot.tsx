import clsx from "clsx";

export type ActivityTone = "error" | "pending" | "success" | "warning";

const toneClasses = {
	error: "bg-danger",
	success: "bg-success",
	warning: "bg-warning",
	pending: "animate-pulse bg-text-subtle motion-reduce:animate-none",
} as const satisfies Record<ActivityTone, string>;

export function StatusDot(props: {
	readonly tone: ActivityTone;
	readonly className?: string | undefined;
}) {
	return (
		<span
			aria-hidden="true"
			className={clsx("size-2 shrink-0 rounded-full", toneClasses[props.tone], props.className)}
		/>
	);
}
