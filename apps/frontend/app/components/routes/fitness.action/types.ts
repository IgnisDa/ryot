import type { SetIdentifier } from "~/lib/state/fitness";

export type FuncStartTimer = (params: {
	duration: number;
	triggeredBy?: SetIdentifier;
	confirmSetOnFinish?: SetIdentifier;
}) => void;
