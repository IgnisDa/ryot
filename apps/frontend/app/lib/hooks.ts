import { useComputedColorScheme, useMantineTheme } from "@mantine/core";
import { useForceUpdate } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	AddEntityToCollectionDocument,
	DeployBulkMetadataProgressUpdateDocument,
	type EntityLot,
	type MediaLot,
	type MetadataProgressUpdateInput,
	RemoveEntityFromCollectionDocument,
	type Scalars,
} from "@ryot/generated/graphql/backend/graphql";
import { useMutation, useQuery } from "@tanstack/react-query";
import Cookies from "js-cookie";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import {
	useRevalidator,
	useRouteLoaderData,
	useSearchParams,
	useSubmit,
} from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
import { useInterval, useMediaQuery } from "usehooks-ts";
import {
	type FitnessAction,
	clientGqlService,
	dayjsLib,
	getMetadataDetailsQuery,
	getMetadataGroupDetailsQuery,
	getPersonDetailsQuery,
	getUserMetadataDetailsQuery,
	getUserMetadataGroupDetailsQuery,
	getUserPersonDetailsQuery,
	refreshEntityDetails,
	selectRandomElement,
} from "~/lib/common";
import {
	type InProgressWorkout,
	useCurrentWorkout,
	useCurrentWorkoutStopwatchAtom,
	useCurrentWorkoutTimerAtom,
} from "~/lib/state/fitness";
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

export const useAppSearchParam = (cookieKey: string) => {
	const [searchParams, setSearchParams] = useSearchParams();

	const updateCookieP = (key: string, value?: string | null) => {
		const cookieValue = Cookies.get(cookieKey);
		const cookieSearchParams = new URLSearchParams(cookieValue);
		if (!value) cookieSearchParams.delete(key);
		else cookieSearchParams.set(key, value);
		Cookies.set(cookieKey, cookieSearchParams.toString(), {
			expires: dayjsLib().add(10, "day").toDate(),
		});
	};

	const delP = (key: string) => {
		setSearchParams(
			(prev) => {
				prev.delete(key);
				return prev;
			},
			{ replace: true },
		);
		updateCookieP(key);
	};

	const setP = (key: string, value?: string | null) => {
		setSearchParams(
			(prev) => {
				if (!value) delP(key);
				else prev.set(key, value);
				return prev;
			},
			{ replace: true },
		);
		updateCookieP(key, value);
	};

	return [searchParams, { setP, delP }] as const;
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
	const revalidator = useRevalidator();
	const navigate = useNavigate();
	const [_w, setCurrentWorkout] = useCurrentWorkout();
	const [_t, setTimer] = useCurrentWorkoutTimerAtom();
	const [_s, setStopwatch] = useCurrentWorkoutStopwatchAtom();

	const fn = (wkt: InProgressWorkout, action: FitnessAction) => {
		setTimer(null);
		setStopwatch(null);
		setCurrentWorkout(wkt);
		navigate($path("/fitness/:action", { action }));
		revalidator.revalidate();
	};
	return fn;
};

export const useMetadataDetails = (metadataId?: string, enabled?: boolean) => {
	return useQuery({ ...getMetadataDetailsQuery(metadataId), enabled });
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

export const usePersonDetails = (personId?: string, enabled?: boolean) => {
	return useQuery({ ...getPersonDetailsQuery(personId), enabled });
};

export const useUserPersonDetails = (personId?: string, enabled?: boolean) => {
	return useQuery({ ...getUserPersonDetailsQuery(personId), enabled });
};

export const useMetadataGroupDetails = (
	metadataGroupId?: string,
	enabled?: boolean,
) => {
	return useQuery({
		...getMetadataGroupDetailsQuery(metadataGroupId),
		enabled,
	});
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

export const useCoreDetails = () => useDashboardLayoutData().coreDetails;
export const useUserDetails = () => useDashboardLayoutData().userDetails;
export const useUserPreferences = () => useUserDetails().preferences;
export const useUserCollections = () =>
	useDashboardLayoutData().userCollections;

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

	return {
		postReview,
		deployImport,
		createWorkout,
		updateProgress,
		addToCollection,
		createMeasurement,
		startOnboardingTour,
		completeOnboardingTour,
	};
};

export const forceUpdateEverySecond = () => {
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

export const useDeployBulkMetadataProgressUpdate = (title: string) => {
	const revalidator = useRevalidator();
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
			events.updateProgress(title);
			setTimeout(() => {
				revalidator.revalidate();
			}, 1500);
		},
	});

	return mutation;
};

export const useAddEntitiesToCollection = () => {
	const revalidator = useRevalidator();

	const mutation = useMutation({
		mutationFn: async (input: {
			creatorUserId: string;
			collectionName: string;
			entities: {
				entityId: string;
				entityLot: EntityLot;
				information?: Scalars["JSON"]["input"];
			}[];
		}) => {
			for (const entity of input.entities) {
				await clientGqlService.request(AddEntityToCollectionDocument, {
					input: {
						entityId: entity.entityId,
						entityLot: entity.entityLot,
						information: entity.information,
						creatorUserId: input.creatorUserId,
						collectionName: input.collectionName,
					},
				});
			}
		},
		onSuccess: () => {
			notifications.show({
				color: "green",
				title: "Success",
				message: "Added to collection",
			});
			revalidator.revalidate();
		},
	});

	return mutation;
};

export const useRemoveEntitiesFromCollection = () => {
	const revalidator = useRevalidator();

	const mutation = useMutation({
		mutationFn: async (input: {
			creatorUserId: string;
			collectionName: string;
			entities: { entityId: string; entityLot: EntityLot }[];
		}) => {
			for (const entity of input.entities) {
				await clientGqlService.request(RemoveEntityFromCollectionDocument, {
					input: {
						entityId: entity.entityId,
						entityLot: entity.entityLot,
						creatorUserId: input.creatorUserId,
						collectionName: input.collectionName,
					},
				});
			}
		},
		onSuccess: () => {
			notifications.show({
				color: "green",
				title: "Success",
				message: "Removed from collection",
			});
			revalidator.revalidate();
		},
	});

	return mutation;
};
