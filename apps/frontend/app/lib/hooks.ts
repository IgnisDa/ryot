import type Umami from "@bitprojects/umami-logger-typescript";
import { $path } from "@ignisda/remix-routes";
import { useComputedColorScheme, useMantineTheme } from "@mantine/core";
import {
	useNavigate,
	useRouteLoaderData,
	useSearchParams,
	useSubmit,
} from "@remix-run/react";
import {
	MetadataDetailsDocument,
	UserMetadataDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import type { EntityLot } from "@ryot/generated/graphql/backend/graphql";
import { queryOptions, skipToken, useQuery } from "@tanstack/react-query";
import Cookies from "js-cookie";
import type { FormEvent } from "react";
import {
	CurrentWorkoutKey,
	clientGqlService,
	dayjsLib,
	getStringAsciiValue,
	queryFactory,
} from "~/lib/generals";
import { type InProgressWorkout, useCurrentWorkout } from "~/lib/state/fitness";
import type { loader } from "~/routes/_dashboard";

declare global {
	interface Window {
		umami?: {
			track: typeof Umami.trackEvent;
		};
	}
}

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

export const useSearchParam = (replace?: boolean) => {
	const [searchParams, setSearchParams] = useSearchParams();

	const delP = (key: string) => {
		setSearchParams(
			(prev) => {
				prev.delete(key);
				return prev;
			},
			{ replace },
		);
	};

	const setP = (key: string, value?: string | null) => {
		setSearchParams(
			(prev) => {
				if (!value) delP(key);
				else prev.set(key, value);
				return prev;
			},
			{ replace },
		);
	};

	return [searchParams, { setP, delP }] as const;
};

export const useCookieEnhancedSearchParam = (cookieKey: string) => {
	const userPreferences = useUserPreferences();
	const [searchParams, { setP, delP }] = useSearchParam(
		userPreferences.general.persistQueries,
	);

	const updateCookieP = (key: string, value?: string | null) => {
		const cookieValue = Cookies.get(cookieKey);
		const cookieSearchParams = new URLSearchParams(cookieValue);
		if (!value) cookieSearchParams.delete(key);
		else cookieSearchParams.set(key, value);
		Cookies.set(cookieKey, cookieSearchParams.toString());
	};

	const delCookieP = (key: string) => {
		delP(key);
		updateCookieP(key);
	};

	const setCookieP = (key: string, value?: string | null) => {
		setP(key, value);
		updateCookieP(key, value);
	};

	return [searchParams, { setP: setCookieP, delP: delCookieP }] as const;
};

export const useActionsSubmit = () => {
	const submit = useSubmit();
	const fn = (e: FormEvent<HTMLFormElement> | HTMLFormElement) => {
		if (e.preventDefault) e.preventDefault();
		submit(e.currentTarget || e, { navigate: false });
	};
	return fn;
};

export const getWorkoutStarter = () => {
	const navigate = useNavigate();
	const [_, setCurrentWorkout] = useCurrentWorkout();

	const fn = (wkt: InProgressWorkout) => {
		setCurrentWorkout(wkt);
		Cookies.set(CurrentWorkoutKey, "true", {
			expires: 2,
			sameSite: "Strict",
		});
		navigate($path("/fitness/workouts/current"));
	};
	return fn;
};

export const getMetadataDetailsQuery = (metadataId?: string | null) =>
	queryOptions({
		queryKey: queryFactory.media.metadataDetails(metadataId || "").queryKey,
		queryFn: metadataId
			? () =>
					clientGqlService
						.request(MetadataDetailsDocument, { metadataId })
						.then((data) => data.metadataDetails)
			: skipToken,
		staleTime: dayjsLib.duration(1, "day").asMilliseconds(),
	});

export const useMetadataDetails = (metadataId?: string | null) => {
	return useQuery(getMetadataDetailsQuery(metadataId));
};

export const getUserMetadataDetailsQuery = (metadataId?: string | null) =>
	queryOptions({
		queryKey: queryFactory.media.userMetadataDetails(metadataId || "").queryKey,
		queryFn: metadataId
			? () =>
					clientGqlService
						.request(UserMetadataDetailsDocument, { metadataId })
						.then((data) => data.userMetadataDetails)
			: skipToken,
	});

export const useUserMetadataDetails = (metadataId?: string | null) => {
	return useQuery(getUserMetadataDetailsQuery(metadataId));
};

const useDashboardLayoutData = () => {
	const loaderData = useRouteLoaderData<typeof loader>("routes/_dashboard");
	return loaderData;
};

export const useCoreDetails = () => useDashboardLayoutData().coreDetails;
export const useUserPreferences = () =>
	useDashboardLayoutData().userPreferences;
export const useUserDetails = () => useDashboardLayoutData().userDetails;
export const useUserCollections = () =>
	useDashboardLayoutData().userCollections;

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
