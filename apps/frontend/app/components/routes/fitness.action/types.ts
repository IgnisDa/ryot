import type { SetIdentifier } from "~/lib/state/fitness";

export type FuncStartTimer = (params: {
	duration: number;
	openTimerDrawer?: boolean;
	triggeredBy?: SetIdentifier;
	confirmSetOnFinish?: SetIdentifier;
}) => void;
