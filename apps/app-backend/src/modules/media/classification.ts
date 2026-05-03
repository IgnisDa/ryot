import { dayjs } from "@ryot/ts-utils";

type NullableDate = Date | null;

type LifecycleSnapshot = {
	entityId: string;
	reviewAt: NullableDate;
	backlogAt: NullableDate;
	progressAt: NullableDate;
	completeAt: NullableDate;
	completedOn: NullableDate;
};

const toMilliseconds = (value: NullableDate) => (value ? dayjs(value).valueOf() : null);

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

const compareEntityIds = (left: string, right: string) => left.localeCompare(right);

export const compareContinueItems = (
	left: Pick<LifecycleSnapshot, "entityId" | "progressAt">,
	right: Pick<LifecycleSnapshot, "entityId" | "progressAt">,
) => {
	const timestampOrder = compareNullableDatesDesc(left.progressAt, right.progressAt);
	return timestampOrder !== 0 ? timestampOrder : compareEntityIds(left.entityId, right.entityId);
};

export const compareUpNextItems = (
	left: Pick<LifecycleSnapshot, "entityId" | "backlogAt">,
	right: Pick<LifecycleSnapshot, "entityId" | "backlogAt">,
) => {
	const timestampOrder = compareNullableDatesDesc(left.backlogAt, right.backlogAt);
	return timestampOrder !== 0 ? timestampOrder : compareEntityIds(left.entityId, right.entityId);
};

export const compareRateTheseItems = (
	left: Pick<LifecycleSnapshot, "entityId" | "completeAt" | "completedOn">,
	right: Pick<LifecycleSnapshot, "entityId" | "completeAt" | "completedOn">,
) => {
	const leftCompletedAt = left.completedOn ?? left.completeAt;
	const rightCompletedAt = right.completedOn ?? right.completeAt;
	const timestampOrder = compareNullableDatesDesc(leftCompletedAt, rightCompletedAt);

	return timestampOrder !== 0 ? timestampOrder : compareEntityIds(left.entityId, right.entityId);
};
