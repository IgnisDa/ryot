export const workoutOperationId = (itemIndex: number, ...parts: Array<string | number>) =>
	JSON.stringify(["workout", itemIndex, ...parts]);

export const workoutRecordId = (itemIndex: number) => JSON.stringify(["workout", itemIndex]);

export const measurementOperationId = (itemIndex: number) =>
	JSON.stringify(["measurement", itemIndex, "entity"]);

export const measurementRecordId = (itemIndex: number) =>
	JSON.stringify(["measurement", itemIndex]);

export const fitnessFailureOperationId = (source: {
	readonly itemIndex: number;
	readonly sourceIdentifier: string;
}) => JSON.stringify(["fitness-source", source.itemIndex, source.sourceIdentifier]);
