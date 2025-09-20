import {
	DeployUpdateMediaEntityJobDocument,
	DeployUpdateMediaTranslationsJobDocument,
	type EntityLot,
	type EntityTranslationVariant,
	MediaSource,
	MediaTranslationDocument,
	MediaTranslationPendingStatus,
	type PodcastTranslationExtraInformationInput,
	type ShowTranslationExtraInformationInput,
} from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	clientGqlService,
	queryFactory,
	refreshEntityDetails,
} from "~/lib/shared/react-query";

export const createDeployMediaEntityJob =
	(entityId: string | undefined, entityLot: EntityLot) => () => {
		if (entityId)
			clientGqlService.request(DeployUpdateMediaEntityJobDocument, {
				input: { entityId, entityLot },
			});
	};

export const useEntityUpdateMonitor = (props: {
	entityId?: string;
	entityLot: EntityLot;
	onUpdate: () => unknown;
	needsRefetch?: boolean | null;
	deployJob: () => void | Promise<void>;
}) => {
	const { entityId, entityLot, onUpdate, needsRefetch } = props;

	const attemptCountRef = useRef(0);
	const isPollingRef = useRef(false);
	const [isPartialStatusActive, setIsPartialStatusActive] = useState(false);
	const jobDeployedForEntityRef = useRef<string | null>(null);
	const pollingEntityIdRef = useRef<string | null>(null);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);

	const scheduleNextPoll = useCallback(() => {
		if (!isPollingRef.current) return;

		if (attemptCountRef.current >= 30) {
			if (pollingEntityIdRef.current)
				refreshEntityDetails(pollingEntityIdRef.current);
			onUpdate();
			isPollingRef.current = false;
			setIsPartialStatusActive(false);
			return;
		}

		timeoutRef.current = setTimeout(async () => {
			if (!isPollingRef.current) return;
			await onUpdate();
			attemptCountRef.current += 1;

			scheduleNextPoll();
		}, 1000);
	}, [onUpdate]);

	const resetPollingState = useCallback(() => {
		const wasPolling = isPollingRef.current;
		const polledEntityId = pollingEntityIdRef.current;

		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = undefined;
		}
		attemptCountRef.current = 0;
		isPollingRef.current = false;
		pollingEntityIdRef.current = null;
		setIsPartialStatusActive(false);

		if (wasPolling && polledEntityId) {
			refreshEntityDetails(polledEntityId);
		}
	}, []);

	useEffect(() => {
		const jobDeployedForEntity = jobDeployedForEntityRef.current;
		const shouldPoll = Boolean(entityId && needsRefetch);
		const isJobForDifferentEntity = Boolean(
			jobDeployedForEntity && jobDeployedForEntity !== entityId,
		);

		if (isJobForDifferentEntity || !entityId) {
			jobDeployedForEntityRef.current = null;
			pollingEntityIdRef.current = null;
		}

		if (!shouldPoll) {
			if (isPollingRef.current) {
				const entityToRefresh = jobDeployedForEntity || entityId;
				if (entityToRefresh) refreshEntityDetails(entityToRefresh);
				resetPollingState();
			}
			return;
		}

		if (isJobForDifferentEntity) {
			if (jobDeployedForEntity) refreshEntityDetails(jobDeployedForEntity);
			resetPollingState();
		}

		if (!isPollingRef.current) {
			if (jobDeployedForEntityRef.current !== entityId && entityId) {
				props.deployJob();
				jobDeployedForEntityRef.current = entityId;
			}

			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
				timeoutRef.current = undefined;
			}

			attemptCountRef.current = 0;
			isPollingRef.current = true;
			pollingEntityIdRef.current = entityId ?? null;
			setIsPartialStatusActive(true);
			scheduleNextPoll();
		}

		return resetPollingState;
	}, [
		onUpdate,
		entityId,
		entityLot,
		needsRefetch,
		props.deployJob,
		scheduleNextPoll,
		resetPollingState,
	]);

	return { isPartialStatusActive };
};

export const useTranslationValue = (props: {
	enabled?: boolean;
	entityId?: string;
	entityLot: EntityLot;
	mediaSource?: MediaSource;
	variant: EntityTranslationVariant;
	showExtraInformation?: ShowTranslationExtraInformationInput;
	podcastExtraInformation?: PodcastTranslationExtraInformationInput;
}) => {
	const translationQuery = useQuery({
		enabled: props.enabled,
		queryKey: queryFactory.media.entityTranslation(
			props.entityId,
			props.entityLot,
			props.variant,
			props.showExtraInformation,
			props.podcastExtraInformation,
		).queryKey,
		queryFn: () => {
			if (props.entityId && props.entityLot)
				return clientGqlService
					.request(MediaTranslationDocument, {
						input: {
							variant: props.variant,
							entityId: props.entityId,
							entityLot: props.entityLot,
							showExtraInformation: props.showExtraInformation,
							podcastExtraInformation: props.podcastExtraInformation,
						},
					})
					.then((data) => data.mediaTranslation);
		},
	});

	const result = translationQuery.data;
	const hasTranslationValue = result?.__typename === "MediaTranslationValue";
	const isPending = result?.__typename === "MediaTranslationPending";
	const isNotFetched =
		isPending && result.status === MediaTranslationPendingStatus.NotFetched;

	useEntityUpdateMonitor({
		entityId: props.entityId,
		entityLot: props.entityLot,
		onUpdate: () => translationQuery.refetch(),
		needsRefetch:
			props.enabled !== false &&
			isPending &&
			props.mediaSource !== MediaSource.Custom,
		deployJob: () => {
			if (props.entityId && isNotFetched)
				clientGqlService.request(DeployUpdateMediaTranslationsJobDocument, {
					input: {
						variant: props.variant,
						entityId: props.entityId,
						entityLot: props.entityLot,
						showExtraInformation: props.showExtraInformation,
						podcastExtraInformation: props.podcastExtraInformation,
					},
				});
		},
	});

	return hasTranslationValue ? result.value : null;
};
