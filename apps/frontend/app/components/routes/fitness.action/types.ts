import type { SetIdentifier } from "~/lib/state/fitness";

export type FuncStartTimer = (
	duration: number,
	triggeredBy?: SetIdentifier,
) => void;
