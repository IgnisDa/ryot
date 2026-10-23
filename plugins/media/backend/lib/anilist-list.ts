import type { ListStateProperties } from "../../shared/list-state";

export const anilistListState = (status: string): ListStateProperties["state"] | undefined => {
	switch (status) {
		case "PLANNING":
			return "backlog";
		case "CURRENT":
		case "REPEATING":
			return "in_progress";
		case "COMPLETED":
			return "complete";
		case "PAUSED":
			return "on_hold";
		case "DROPPED":
			return "dropped";
		default:
			return undefined;
	}
};
