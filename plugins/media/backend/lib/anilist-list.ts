import type { ListStateProperties } from "../../shared/list-state";

export const anilistListState = (status: string): undefined | ListStateProperties["state"] => {
	switch (status) {
		case "PAUSED":
			return "on_hold";
		case "CURRENT":
		case "REPEATING":
			return "in_progress";
		case "DROPPED":
			return "dropped";
		case "PLANNING":
			return "backlog";
		case "COMPLETED":
			return "complete";
		default:
			return undefined;
	}
};
