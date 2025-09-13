import { useComputedColorScheme, useMantineTheme } from "@mantine/core";
import { useForceUpdate } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	type ChangeCollectionToEntitiesInput,
	DeployAddEntitiesToCollectionJobDocument,
	DeployBulkMetadataProgressUpdateDocument,
	DeployRemoveEntitiesFromCollectionJobDocument,
	DeployUpdateMediaEntityJobDocument,
	EntityLot,
	ExpireCacheKeyDocument,
	type MediaLot,
	MediaSource,
	type MetadataProgressUpdateInput,
	UpdateUserDocument,
	UserCollectionsListDocument,
	UsersListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
	useFetcher,
	useRevalidator,
	useRouteLoaderData,
	useSubmit,
} from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { useInterval, useMediaQuery } from "usehooks-ts";
import {
	clientGqlService,
	getMetadataDetailsQuery,
	getMetadataGroupDetailsQuery,
	getPersonDetailsQuery,
	getUserMetadataDetailsQuery,
	getUserMetadataGroupDetailsQuery,
	getUserPersonDetailsQuery,
	queryFactory,
	refreshEntityDetails,
} from "~/lib/shared/react-query";
import { selectRandomElement } from "~/lib/shared/ui-utils";
import {
	type InProgressWorkout,
	useCurrentWorkout,
	useCurrentWorkoutStopwatchAtom,
	useCurrentWorkoutTimerAtom,
} from "~/lib/state/fitness";
import type { FitnessAction } from "~/lib/types";
import type { loader as dashboardLoader } from "~/routes/_dashboard";

export const useGetMantineColors = () => {
	const theme = useMantineTheme();
	const colors = Object.keys(theme.colors);
	return colors;
};

export const useGetRandomMantineColor = (input: string) => {
	const colors = useGetMantineColors();
	return selectRandomElement(colors, input);
};

export const useFallbackImageUrl = (text = "No Image") => {
	const colorScheme = useComputedColorScheme("dark");
	return `https://placehold.co/100x200/${
		colorScheme === "dark" ? "343632" : "c1c4bb"
	}/${colorScheme === "dark" ? "FFF" : "121211"}?text=${text}`;
};

export const useConfirmSubmit = () => {
	const submit = useSubmit();
	const fn = (e: FormEvent<HTMLFormElement> | HTMLFormElement | null) => {
		if (!e) return;
		if (e.preventDefault) e.preventDefault();
		submit(e.currentTarget || e, { navigate: false });
	};
	return fn;
};

export const useGetWorkoutStarter = () => {
	const navigate = useNavigate();
	const [_w, setCurrentWorkout] = useCurrentWorkout();
	const [_t, setTimer] = useCurrentWorkoutTimerAtom();
	const [_s, setStopwatch] = useCurrentWorkoutStopwatchAtom();

	const fn = (wkt: InProgressWorkout, action: FitnessAction) => {
		setTimer(null);
		setStopwatch(null);
		setCurrentWorkout(wkt);
		navigate($path("/fitness/:action", { action }));
	};
	return fn;
};

export const usePartialStatusMonitor = (props: {
	entityId?: string;
	entityLot: EntityLot;
	onUpdate: () => unknown;
	partialStatus?: boolean | null;
	externalLinkSource: MediaSource;
}) => {
	const { entityId, entityLot, onUpdate, partialStatus, externalLinkSource } =
		props;

	const [jobDeployedForEntity, setJobDeployedForEntity] = useState<
		string | null
	>(null);
	const [isPartialStatusActive, setIsPartialStatusActive] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const attemptCountRef = useRef(0);
	const isPollingRef = useRef(false);

	const scheduleNextPoll = useCallback(() => {
		if (!isPollingRef.current) return;

		if (attemptCountRef.current >= 30) {
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
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = undefined;
		}
		attemptCountRef.current = 0;
		isPollingRef.current = false;
		setIsPartialStatusActive(false);
	}, []);

	useEffect(() => {
		resetPollingState();

		const isJobForDifferentEntity =
			jobDeployedForEntity && jobDeployedForEntity !== entityId;
		const shouldPoll =
			entityId && partialStatus && externalLinkSource !== MediaSource.Custom;

		if (isJobForDifferentEntity || !entityId) setJobDeployedForEntity(null);

		if (!shouldPoll) return;

		if (jobDeployedForEntity !== entityId && entityId) {
			clientGqlService.request(DeployUpdateMediaEntityJobDocument, {
				entityId,
				entityLot,
			});
			setJobDeployedForEntity(entityId);
		}

		isPollingRef.current = true;
		setIsPartialStatusActive(true);
		scheduleNextPoll();

		return resetPollingState;
	}, [
		onUpdate,
		entityId,
		entityLot,
		partialStatus,
		scheduleNextPoll,
		resetPollingState,
		externalLinkSource,
		jobDeployedForEntity,
	]);

	return { isPartialStatusActive };
};

export const useMetadataDetails = (metadataId?: string, enabled?: boolean) => {
	const query = useQuery({ ...getMetadataDetailsQuery(metadataId), enabled });

	const { isPartialStatusActive } = usePartialStatusMonitor({
		entityId: metadataId,
		entityLot: EntityLot.Metadata,
		onUpdate: () => query.refetch(),
		partialStatus: enabled !== false && query.data?.isPartial,
		externalLinkSource: query.data?.source || MediaSource.Custom,
	});

	return [query, isPartialStatusActive] as const;
};

export const useUserMetadataDetails = (
	metadataId?: string,
	enabled?: boolean,
) => {
	return useQuery({
		...getUserMetadataDetailsQuery(metadataId),
		enabled,
	});
};

export const usePersonDetails = (personId: string, enabled?: boolean) => {
	const query = useQuery({ ...getPersonDetailsQuery(personId), enabled });

	const { isPartialStatusActive } = usePartialStatusMonitor({
		entityId: personId,
		entityLot: EntityLot.Person,
		onUpdate: () => query.refetch(),
		partialStatus: enabled !== false && query.data?.details.isPartial,
		externalLinkSource: query.data?.details.source || MediaSource.Custom,
	});

	return [query, isPartialStatusActive] as const;
};

export const useUserPersonDetails = (personId?: string, enabled?: boolean) => {
	return useQuery({ ...getUserPersonDetailsQuery(personId), enabled });
};

export const useMetadataGroupDetails = (
	metadataGroupId?: string,
	enabled?: boolean,
) => {
	const query = useQuery({
		...getMetadataGroupDetailsQuery(metadataGroupId),
		enabled,
	});

	const { isPartialStatusActive } = usePartialStatusMonitor({
		entityId: metadataGroupId,
		onUpdate: () => query.refetch(),
		entityLot: EntityLot.MetadataGroup,
		partialStatus: enabled !== false && query.data?.details.isPartial,
		externalLinkSource: query.data?.details.source || MediaSource.Custom,
	});

	return [query, isPartialStatusActive] as const;
};

export const useUserMetadataGroupDetails = (
	metadataGroupId?: string,
	enabled?: boolean,
) => {
	return useQuery({
		...getUserMetadataGroupDetailsQuery(metadataGroupId),
		enabled,
	});
};

export const useDashboardLayoutData = () => {
	const loaderData =
		useRouteLoaderData<typeof dashboardLoader>("routes/_dashboard");
	invariant(loaderData);
	return loaderData;
};

export const useUserPreferences = () => useUserDetails().preferences;
export const useCoreDetails = () => useDashboardLayoutData().coreDetails;
export const useUserDetails = () => useDashboardLayoutData().userDetails;

export const useUserCollections = () => {
	const query = useQuery({
		queryKey: queryFactory.collections.userCollectionsList().queryKey,
		queryFn: () =>
			clientGqlService
				.request(UserCollectionsListDocument)
				.then((d) => d.userCollectionsList.response),
	});

	return query.data || [];
};

export const useNonHiddenUserCollections = () => {
	const userCollections = useUserCollections();
	const userDetails = useUserDetails();
	const toDisplay = userCollections.filter(
		(c) =>
			c.collaborators.find((c) => c.collaborator.id === userDetails.id)
				?.extraInformation?.isHidden !== true,
	);
	return toDisplay;
};

export const useUserUnitSystem = () =>
	useUserPreferences().fitness.exercises.unitSystem;

export const useApplicationEvents = () => {
	const { version, isServerKeyValidated: isPro } = useCoreDetails();

	const sendEvent = (eventName: string, data: Record<string, unknown>) => {
		window.umami?.track(eventName, { isPro, version, ...data });
	};

	const updateProgress = (title: string) => {
		sendEvent("Update Progress", { title });
	};
	const postReview = (title: string) => {
		sendEvent("Post Review", { title });
	};
	const deployImport = (source: string) => {
		sendEvent("Deploy Import", { source });
	};
	const createWorkout = () => {
		sendEvent("Create Workout", {});
	};
	const createMeasurement = () => {
		sendEvent("Create Measurement", {});
	};
	const addToCollection = (entityLot: EntityLot) => {
		sendEvent("Add To Collection", { entityLot });
	};
	const startOnboardingTour = () => {
		sendEvent("Start Onboarding Tour", {});
	};
	const completeOnboardingTour = () => {
		sendEvent("Complete Onboarding Tour", {});
	};
	const createOrUpdateIntegration = (provider: string, isUpdate: boolean) => {
		sendEvent(isUpdate ? "Update Integration" : "Create Integration", {
			provider,
		});
	};

	return {
		postReview,
		deployImport,
		createWorkout,
		updateProgress,
		addToCollection,
		createMeasurement,
		startOnboardingTour,
		completeOnboardingTour,
		createOrUpdateIntegration,
	};
};

export const useForceUpdateEverySecond = () => {
	const forceUpdate = useForceUpdate();
	useInterval(forceUpdate, 1000);
};

export const useGetWatchProviders = (mediaLot: MediaLot) => {
	const userPreferences = useUserPreferences();
	const watchProviders =
		userPreferences.general.watchProviders.find((l) => l.lot === mediaLot)
			?.values || [];
	return watchProviders;
};

export const useIsFitnessActionActive = () => {
	const [currentWorkout] = useCurrentWorkout();
	const action = currentWorkout?.currentAction;
	return action !== undefined;
};

export const useIsMobile = () => {
	const isMobile = useMediaQuery("(max-width: 768px)");
	return isMobile;
};

export const useIsOnboardingTourCompleted = () => {
	const dashboardData = useDashboardLayoutData();
	return dashboardData.isOnboardingTourCompleted;
};

export const useDeployBulkMetadataProgressUpdateMutation = (title?: string) => {
	const events = useApplicationEvents();

	const mutation = useMutation({
		mutationFn: async (input: MetadataProgressUpdateInput[]) => {
			const resp = await clientGqlService.request(
				DeployBulkMetadataProgressUpdateDocument,
				{ input },
			);
			return [resp, input.map((i) => i.metadataId)] as const;
		},
		onSuccess: (data) => {
			for (const id of data[1]) {
				refreshEntityDetails(id);
			}
			notifications.show({
				color: "green",
				title: "Progress Updated",
				message: "Progress will be updated shortly",
			});
			events.updateProgress(title || "");
		},
	});

	return mutation;
};

export const useAddEntitiesToCollectionMutation = () => {
	const mutation = useMutation({
		mutationFn: async (input: ChangeCollectionToEntitiesInput) => {
			await clientGqlService.request(DeployAddEntitiesToCollectionJobDocument, {
				input,
			});
			return input;
		},
		onSettled: (d) => {
			for (const e of d?.entities || []) refreshEntityDetails(e.entityId);
		},
	});
	return mutation;
};

export const useRemoveEntitiesFromCollectionMutation = () => {
	const mutation = useMutation({
		mutationFn: async (input: ChangeCollectionToEntitiesInput) => {
			await clientGqlService.request(
				DeployRemoveEntitiesFromCollectionJobDocument,
				{ input },
			);
			return input;
		},
		onSettled: (d) => {
			for (const e of d?.entities || []) refreshEntityDetails(e.entityId);
		},
	});
	return mutation;
};

export const useExpireCacheKeyMutation = () =>
	useMutation({
		mutationFn: async (cacheId: string) => {
			await clientGqlService.request(ExpireCacheKeyDocument, { cacheId });
		},
	});

export const useUsersList = (query?: string) =>
	useQuery({
		queryKey: queryFactory.miscellaneous.usersList(query).queryKey,
		queryFn: () =>
			clientGqlService
				.request(UsersListDocument, { query })
				.then((data) => data.usersList),
	});

export const useFormValidation = (dependency?: unknown) => {
	const formRef = useRef<HTMLFormElement>(null);
	const [isFormValid, setIsFormValid] = useState(true);

	const checkFormValidity = useCallback(() => {
		if (formRef.current) {
			setIsFormValid(formRef.current.checkValidity());
		}
	}, []);

	useEffect(() => {
		checkFormValidity();
	}, [checkFormValidity, dependency]);

	return { formRef, isFormValid, checkFormValidity };
};

export const useInvalidateUserDetails = () => {
	const fetcher = useFetcher();
	const revalidator = useRevalidator();

	const invalidateUserDetails = useCallback(async () => {
		fetcher.submit(
			{ dummy: "data" },
			{
				method: "POST",
				action: $path("/actions", { intent: "invalidateUserDetails" }),
			},
		);
		await new Promise((r) => setTimeout(r, 1000));
		revalidator.revalidate();
	}, [fetcher, revalidator]);

	return invalidateUserDetails;
};

export const useMarkUserOnboardingTourStatus = () => {
	const userDetails = useUserDetails();
	const invalidateUserDetails = useInvalidateUserDetails();

	const markUserOnboardingTourAsCompleted = useMutation({
		mutationFn: async (isComplete: boolean) =>
			clientGqlService.request(UpdateUserDocument, {
				input: {
					userId: userDetails.id,
					isOnboardingTourCompleted: isComplete,
				},
			}),
		onSuccess: () => invalidateUserDetails(),
	});

	return markUserOnboardingTourAsCompleted;
};
