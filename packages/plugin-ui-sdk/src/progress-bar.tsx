import clsx from "clsx";

const toneClasses = { info: "bg-info", accent: "bg-accent", success: "bg-success" } as const;

export function ProgressBar(props: {
	readonly max: number;
	readonly label: string;
	readonly value: number;
	readonly className?: string | undefined;
	readonly fillClassName?: string | undefined;
	readonly tone: keyof typeof toneClasses;
}) {
	const max = Math.max(0, props.max);
	const value = Math.min(max, Math.max(0, props.value));
	return (
		<div
			aria-valuemin={0}
			role="progressbar"
			aria-valuemax={max}
			aria-label={props.label}
			aria-valuenow={Math.round(value)}
			className={clsx("h-1 overflow-hidden rounded-pill bg-surface-2", props.className)}
		>
			<div
				style={{ width: `${max === 0 ? 0 : (value / max) * 100}%` }}
				className={clsx(
					"h-full rounded-pill transition-[width] motion-reduce:transition-none",
					toneClasses[props.tone],
					props.fillClassName,
				)}
			/>
		</div>
	);
}
