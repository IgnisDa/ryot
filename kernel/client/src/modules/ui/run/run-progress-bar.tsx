import clsx from "clsx";
import { View } from "react-native";

import type { RunProgress, RunProgressValue } from "./run-status";

export function RunProgressBar(props: {
	readonly className?: string;
	readonly progress: RunProgress;
	readonly value: RunProgressValue;
}) {
	return (
		<View
			accessible
			accessibilityRole="progressbar"
			accessibilityValue={props.value}
			className={clsx("h-1.5 overflow-hidden rounded-pill bg-surface-2", props.className)}
		>
			{props.progress.kind === "determinate" ? (
				<View
					className="h-full rounded-pill bg-accent"
					style={{ width: `${props.progress.percent}%` }}
				/>
			) : (
				<View className="h-full w-1/3 rounded-pill bg-accent-border" />
			)}
		</View>
	);
}
