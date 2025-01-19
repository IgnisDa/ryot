import { useComputedColorScheme, useMantineTheme } from "@mantine/core";
import { useForceUpdate } from "@mantine/hooks";
import {
	useRevalidator,
	useRouteLoaderData,
	useSearchParams,
	useSubmit,
} from "@remix-run/react";
import type {
	EntityLot,
	MediaLot,
} from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import Cookies from "js-cookie";
import type { FormEvent } from "react";
import { $path } from "remix-routes";
import invariant from "tiny-invariant";
import { useInterval } from "usehooks-ts";
import {
	type FitnessAction,
	dayjsLib,
	getMetadataDetailsQuery,
	getUserMetadataDetailsQuery,
	selectRandomElement,
} from "~/lib/generals";
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
	const coreDetails = useCoreDetails();

	const updateCookieP = (key: string, value?: string | null) => {
		const cookieValue = Cookies.get(cookieKey);
		const cookieSearchParams = new URLSearchParams(cookieValue);
		if (!value) cookieSearchParams.delete(key);
		else cookieSearchParams.set(key, value);
		Cookies.set(cookieKey, cookieSearchParams.toString(), {
			expires: dayjsLib().add(coreDetails.tokenValidForDays, "day").toDate(),
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
	const [_w, setCurrentWorkout] = useCurrentWorkout();
	const [_t, setTimer] = useCurrentWorkoutTimerAtom();
	const [_s, setStopwatch] = useCurrentWorkoutStopwatchAtom();

	const fn = (wkt: InProgressWorkout, action: FitnessAction) => {
		setTimer(null);
		setStopwatch(null);
		setCurrentWorkout(wkt);
		window.location.href = $path("/fitness/:action", { action });
		revalidator.revalidate();
	};
	return fn;
};

export const useMetadataDetails = (
	metadataId?: string | null,
	enabled?: boolean,
) => {
	return useQuery({ ...getMetadataDetailsQuery(metadataId), enabled });
};

export const useUserMetadataDetails = (
	metadataId?: string | null,
	enabled?: boolean,
) => {
	return useQuery({
		...getUserMetadataDetailsQuery(metadataId),
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

	return {
		updateProgress,
		postReview,
		deployImport,
		createWorkout,
		createMeasurement,
		addToCollection,
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
