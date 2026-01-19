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
import { useEffect, useRef } from "react";
import {
	clientGqlService,
	queryFactory,
	refreshEntityDetails,
} from "~/lib/shared/react-query";

const POLLING_INTERVAL = 1000;
const MAX_POLLING_ATTEMPTS = 30;

const deployedJobs = new Set<string>();

const createJobKey = (entityId: string, entityLot: EntityLot, extra?: string) =>
	`${entityLot}:${entityId}${extra ? `:${extra}` : ""}`;

const useDeployJobOnce = (
	shouldDeploy: boolean,
	entityId: string | undefined,
	jobKey: string,
	deployFn: () => void,
) => {
	const deployedForEntityRef = useRef<string | null>(null);

	useEffect(() => {
		if (!shouldDeploy || !entityId) {
			deployedForEntityRef.current = null;
			return;
		}

		if (deployedJobs.has(jobKey) || deployedForEntityRef.current === entityId)
			return;

		deployedJobs.add(jobKey);
		deployedForEntityRef.current = entityId;
		deployFn();
	}, [shouldDeploy, entityId, jobKey, deployFn]);
};

export const createDeployMediaEntityJob =
	(entityId: string | undefined, entityLot: EntityLot) => () => {
		if (entityId)
			clientGqlService.request(DeployUpdateMediaEntityJobDocument, {
				input: { entityId, entityLot },
			});
	};

export const useEntityDetailsPolling = (props: {
	entityId?: string;
	entityLot: EntityLot;
	needsRefetch?: boolean | null;
}) => {
	const attemptCountRef = useRef(0);
	const wasPollingRef = useRef(false);
	const pollingEntityIdRef = useRef<string | null>(null);

	const shouldPoll = Boolean(props.entityId && props.needsRefetch);
	const jobKey = createJobKey(props.entityId || "", props.entityLot);

	useDeployJobOnce(
		shouldPoll,
		props.entityId,
		jobKey,
		createDeployMediaEntityJob(props.entityId, props.entityLot),
	);

	useEffect(() => {
		if (wasPollingRef.current && !shouldPoll) {
			const entityToRefresh = pollingEntityIdRef.current;
			if (entityToRefresh) refreshEntityDetails(entityToRefresh);
			attemptCountRef.current = 0;
			pollingEntityIdRef.current = null;
		}
		if (shouldPoll && props.entityId)
			pollingEntityIdRef.current = props.entityId;
		wasPollingRef.current = shouldPoll;
	}, [shouldPoll, props.entityId]);

	const refetchInterval = (): number | false => {
		if (!shouldPoll) {
			attemptCountRef.current = 0;
			return false;
		}
		if (attemptCountRef.current >= MAX_POLLING_ATTEMPTS) {
			if (props.entityId) refreshEntityDetails(props.entityId);
			return false;
		}
		attemptCountRef.current += 1;
		return POLLING_INTERVAL;
	};

	return { isPartialStatusActive: shouldPoll, refetchInterval };
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
		refetchInterval: (query) => {
			const result = query.state.data;
			const isPending = result?.__typename === "MediaTranslationPending";
			const shouldPoll =
				props.enabled !== false &&
				isPending &&
				props.mediaSource !== MediaSource.Custom;
			return shouldPoll ? POLLING_INTERVAL : false;
		},
	});

	const result = translationQuery.data;
	const hasTranslationValue = result?.__typename === "MediaTranslationValue";
	const isPending = result?.__typename === "MediaTranslationPending";
	const isNotFetched =
		isPending && result.status === MediaTranslationPendingStatus.NotFetched;

	const jobKey = createJobKey(
		props.entityId || "",
		props.entityLot,
		`translation:${props.variant}`,
	);

	useDeployJobOnce(
		props.enabled !== false &&
			isNotFetched &&
			props.mediaSource !== MediaSource.Custom,
		props.entityId,
		jobKey,
		() => {
			if (props.entityId)
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
	);

	return hasTranslationValue ? result.value : null;
};
