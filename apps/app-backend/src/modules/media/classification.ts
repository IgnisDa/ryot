type NullableDate = Date | null;

type LifecycleState = "continue" | "upNext" | null;

export type BuiltInMediaLifecycleSnapshot = {
	entityId: string;
	reviewAt: NullableDate;
	backlogAt: NullableDate;
	progressAt: NullableDate;
	completeAt: NullableDate;
	completedOn: NullableDate;
};

const toMilliseconds = (value: NullableDate) => value?.getTime() ?? null;

const compareNullableDatesDesc = (left: NullableDate, right: NullableDate) => {
	const leftMilliseconds = toMilliseconds(left);
	const rightMilliseconds = toMilliseconds(right);

	if (leftMilliseconds === rightMilliseconds) {
		return 0;
	}
	if (leftMilliseconds === null) {
		return 1;
	}
	if (rightMilliseconds === null) {
		return -1;
	}

	return rightMilliseconds - leftMilliseconds;
};

const compareEntityIds = (left: string, right: string) =>
	left.localeCompare(right);

export const resolveBuiltInMediaLifecycleState = (
	input: Pick<
		BuiltInMediaLifecycleSnapshot,
		"backlogAt" | "progressAt" | "completeAt"
	>,
): LifecycleState => {
	const backlogAt = toMilliseconds(input.backlogAt);
	const completeAt = toMilliseconds(input.completeAt);
	const progressAt = toMilliseconds(input.progressAt);

	if (
		completeAt !== null &&
		(progressAt === null || completeAt >= progressAt) &&
		(backlogAt === null || completeAt >= backlogAt)
	) {
		return null;
	}

	if (progressAt !== null && (backlogAt === null || progressAt >= backlogAt)) {
		return "continue";
	}

	if (backlogAt !== null) {
		return "upNext";
	}

	return null;
};

export const resolveBuiltInMediaRateTheseMembership = (
	input: Pick<
		BuiltInMediaLifecycleSnapshot,
		"completeAt" | "completedOn" | "reviewAt"
	>,
) => {
	const completionAt = input.completedOn ?? input.completeAt;
	if (!completionAt) {
		return false;
	}
	if (!input.reviewAt) {
		return true;
	}

	return completionAt.getTime() > input.reviewAt.getTime();
};

export const compareContinueItems = (
	left: Pick<BuiltInMediaLifecycleSnapshot, "entityId" | "progressAt">,
	right: Pick<BuiltInMediaLifecycleSnapshot, "entityId" | "progressAt">,
) => {
	const timestampOrder = compareNullableDatesDesc(
		left.progressAt,
		right.progressAt,
	);
	return timestampOrder !== 0
		? timestampOrder
		: compareEntityIds(left.entityId, right.entityId);
};

export const compareUpNextItems = (
	left: Pick<BuiltInMediaLifecycleSnapshot, "entityId" | "backlogAt">,
	right: Pick<BuiltInMediaLifecycleSnapshot, "entityId" | "backlogAt">,
) => {
	const timestampOrder = compareNullableDatesDesc(
		left.backlogAt,
		right.backlogAt,
	);
	return timestampOrder !== 0
		? timestampOrder
		: compareEntityIds(left.entityId, right.entityId);
};

export const compareRateTheseItems = (
	left: Pick<
		BuiltInMediaLifecycleSnapshot,
		"entityId" | "completeAt" | "completedOn"
	>,
	right: Pick<
		BuiltInMediaLifecycleSnapshot,
		"entityId" | "completeAt" | "completedOn"
	>,
) => {
	const leftCompletedAt = left.completedOn ?? left.completeAt;
	const rightCompletedAt = right.completedOn ?? right.completeAt;
	const timestampOrder = compareNullableDatesDesc(
		leftCompletedAt,
		rightCompletedAt,
	);

	return timestampOrder !== 0
		? timestampOrder
		: compareEntityIds(left.entityId, right.entityId);
};
