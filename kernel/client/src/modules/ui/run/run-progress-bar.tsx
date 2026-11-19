import clsx from "clsx";

import type { RunProgress, RunProgressValue } from "#/modules/ui/run/run-status";

export function RunProgressBar(props: {
	readonly className?: string;
	readonly progress: RunProgress;
	readonly value: RunProgressValue;
}) {
	return (
		<div
			role="progressbar"
			aria-valuenow={props.value.now}
			aria-valuemin={props.value.min}
			aria-valuemax={props.value.max}
			aria-valuetext={props.value.text}
			className={clsx("h-1.5 overflow-hidden rounded-full bg-surface-2", props.className)}
		>
			{props.progress.kind === "determinate" ? (
				<div
					className="h-full rounded-full bg-accent"
					style={{ width: `${props.progress.percent}%` }}
				/>
			) : (
				<div className="h-full w-1/3 rounded-full bg-accent-border" />
			)}
		</div>
	);
}
