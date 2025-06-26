import { $path } from "safe-routes";
import { dayjsLib } from "~/lib/common";
import type { CurrentWorkoutStopwatch } from "~/lib/state/fitness";

export const DEFAULT_SET_TIMEOUT_DELAY_MS = 800;

export const getStopwatchMilliSeconds = (
	currentStopwatch: CurrentWorkoutStopwatch,
) => {
	if (!currentStopwatch) return 0;
	let total = 0;
	for (const duration of currentStopwatch) {
		total += dayjsLib(duration.to).diff(duration.from);
	}
	return total;
};

export const styles = {
	body: {
		height: "80%",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	},
};

export const formatTimerDuration = (duration: number) =>
	dayjsLib.duration(duration).format("mm:ss");

export const deleteUploadedAsset = (key: string) => {
	const formData = new FormData();
	formData.append("key", key);
	fetch($path("/actions", { intent: "deleteS3Asset" }), {
		method: "POST",
		body: formData,
	});
};
