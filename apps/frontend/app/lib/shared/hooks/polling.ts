import type { EntityLot } from "@ryot/generated/graphql/backend/graphql";
import { useEffect, useMemo, useRef } from "react";
import { refreshEntityDetails } from "~/lib/shared/react-query";

const deployedJobsTracker = new Set<string>();
const pollingAttemptsTracker = new Map<string, number>();
const MAX_POLLING_ATTEMPTS = 30;
const POLLING_INTERVAL_MS = 1000;

const getEntityPollingKey = (
	entityId: string | undefined,
	entityLot: EntityLot,
	variant?: string,
) =>
	entityId ? `${entityLot}:${entityId}${variant ? `:${variant}` : ""}` : "";

const shouldDeployJob = (
	entityId: string | undefined,
	entityLot: EntityLot,
) => {
	if (!entityId) return false;
	const key = getEntityPollingKey(entityId, entityLot);
	if (deployedJobsTracker.has(key)) return false;
	deployedJobsTracker.add(key);
	return true;
};

const clearDeployedJob = (
	entityId: string | undefined,
	entityLot: EntityLot,
) => {
	if (!entityId) return;
	const key = getEntityPollingKey(entityId, entityLot);
	deployedJobsTracker.delete(key);
	pollingAttemptsTracker.delete(key);
};

const incrementPollingAttempts = (
	entityId: string | undefined,
	entityLot: EntityLot,
	variant?: string,
): number => {
	if (!entityId) return 0;
	const key = getEntityPollingKey(entityId, entityLot, variant);
	const current = pollingAttemptsTracker.get(key) || 0;
	pollingAttemptsTracker.set(key, current + 1);
	return current + 1;
};

const getPollingAttempts = (
	entityId: string | undefined,
	entityLot: EntityLot,
	variant?: string,
): number => {
	if (!entityId) return 0;
	const key = getEntityPollingKey(entityId, entityLot, variant);
	return pollingAttemptsTracker.get(key) || 0;
};

const resetPollingAttempts = (
	entityId: string | undefined,
	entityLot: EntityLot,
	variant?: string,
) => {
	if (!entityId) return;
	const key = getEntityPollingKey(entityId, entityLot, variant);
	pollingAttemptsTracker.delete(key);
};

export const useEntityPolling = (props: {
	entityId?: string;
	entityLot: EntityLot;
	isPartial?: boolean;
	isCustomSource?: boolean;
	enabled?: boolean;
	variant?: string;
	deployJob?: () => void;
	onMaxAttemptsReached?: () => void;
}): { refetchInterval: number | false; isPartialStatusActive: boolean } => {
	const {
		entityId,
		entityLot,
		isPartial,
		isCustomSource,
		enabled = true,
		variant,
		deployJob,
		onMaxAttemptsReached,
	} = props;

	const shouldPoll = Boolean(
		enabled && entityId && isPartial && !isCustomSource,
	);
	const prevShouldPollRef = useRef(shouldPoll);
	const prevEntityIdRef = useRef(entityId);

	useEffect(() => {
		if (entityId !== prevEntityIdRef.current) {
			if (prevEntityIdRef.current) {
				clearDeployedJob(prevEntityIdRef.current, entityLot);
				resetPollingAttempts(prevEntityIdRef.current, entityLot, variant);
			}
			prevEntityIdRef.current = entityId;
		}
	}, [entityId, entityLot, variant]);

	useEffect(() => {
		if (shouldPoll && deployJob && shouldDeployJob(entityId, entityLot)) {
			deployJob();
		}
	}, [shouldPoll, entityId, entityLot, deployJob]);

	useEffect(() => {
		if (!shouldPoll && prevShouldPollRef.current && entityId) {
			clearDeployedJob(entityId, entityLot);
			resetPollingAttempts(entityId, entityLot, variant);
			refreshEntityDetails(entityId);
		}
		prevShouldPollRef.current = shouldPoll;
	}, [shouldPoll, entityId, entityLot, variant]);

	useEffect(() => {
		return () => {
			if (entityId) {
				clearDeployedJob(entityId, entityLot);
				resetPollingAttempts(entityId, entityLot, variant);
			}
		};
	}, [entityId, entityLot, variant]);

	const refetchInterval = useMemo(() => {
		if (!shouldPoll) return false;
		const attempts = getPollingAttempts(entityId, entityLot, variant);
		if (attempts >= MAX_POLLING_ATTEMPTS) {
			if (entityId) {
				refreshEntityDetails(entityId);
				clearDeployedJob(entityId, entityLot);
				resetPollingAttempts(entityId, entityLot, variant);
			}
			onMaxAttemptsReached?.();
			return false;
		}
		incrementPollingAttempts(entityId, entityLot, variant);
		return POLLING_INTERVAL_MS;
	}, [shouldPoll, entityId, entityLot, variant, onMaxAttemptsReached]);

	return { refetchInterval, isPartialStatusActive: shouldPoll };
};
