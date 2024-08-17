import { useComputedColorScheme, useMantineTheme } from "@mantine/core";
import { useForceUpdate } from "@mantine/hooks";
import {
	useNavigate,
	useRouteLoaderData,
	useSearchParams,
	useSubmit,
} from "@remix-run/react";
import type { EntityLot } from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import Cookies from "js-cookie";
import type { FormEvent } from "react";
import { $path } from "remix-routes";
import { useInterval } from "usehooks-ts";
import {
	CurrentWorkoutKey,
	dayjsLib,
	getMetadataDetailsQuery,
	getStringAsciiValue,
	getUserMetadataDetailsQuery,
} from "~/lib/generals";
import { type InProgressWorkout, useCurrentWorkout } from "~/lib/state/fitness";
import type { loader as dashboardLoader } from "~/routes/_dashboard";

export const useGetMantineColor = () => {
	const theme = useMantineTheme();
	const colors = Object.keys(theme.colors);

	// taken from https://stackoverflow.com/questions/44975435/using-mod-operator-in-javascript-to-wrap-around#comment76926119_44975435
	const getColor = (input: string) =>
		colors[(getStringAsciiValue(input) + colors.length) % colors.length];

	return getColor;
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
	const fn = (e: FormEvent<HTMLFormElement> | HTMLFormElement) => {
		if (e.preventDefault) e.preventDefault();
		submit(e.currentTarget || e, { navigate: false });
	};
	return fn;
};

export const useGetWorkoutStarter = () => {
	const navigate = useNavigate();
	const [_, setCurrentWorkout] = useCurrentWorkout();

	const fn = (wkt: InProgressWorkout, value: "workouts" | "templates") => {
		setCurrentWorkout(wkt);
		Cookies.set(CurrentWorkoutKey, value, {
			expires: 2,
			sameSite: "Strict",
		});
		navigate(
			$path("/fitness/:action", {
				action: value === "workouts" ? "log-workout" : "create-template",
			}),
		);
	};
	return fn;
};

export const useMetadataDetails = (metadataId?: string | null) => {
	return useQuery(getMetadataDetailsQuery(metadataId));
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
	return loaderData;
};

export const useCoreDetails = () => useDashboardLayoutData().coreDetails;
export const useUserPreferences = () =>
	useDashboardLayoutData().userPreferences;
export const useUserDetails = () => useDashboardLayoutData().userDetails;
export const useUserCollections = () =>
	useDashboardLayoutData().userCollections;

export const useUserUnitSystem = () =>
	useUserPreferences().fitness.exercises.unitSystem;

export const useApplicationEvents = () => {
	const { version, isPro } = useCoreDetails();

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
