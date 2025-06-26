export type FuncStartTimer = (
	duration: number,
	triggeredBy: { exerciseIdentifier: string; setIdentifier: string },
) => void;
