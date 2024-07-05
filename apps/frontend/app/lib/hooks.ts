import { $path } from "@ignisda/remix-routes";
import { useComputedColorScheme, useMantineTheme } from "@mantine/core";
import {
	useNavigate,
	useRouteLoaderData,
	useSearchParams,
} from "@remix-run/react";
import {
	MetadataDetailsDocument,
	UserMetadataDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { queryOptions, skipToken, useQuery } from "@tanstack/react-query";
import Cookies from "js-cookie";
import {
	CurrentWorkoutKey,
	clientGqlService,
	dayjsLib,
	getStringAsciiValue,
	queryFactory,
} from "~/lib/generals";
import { type InProgressWorkout, useCurrentWorkout } from "~/lib/state/fitness";
import type { loader } from "~/routes/_dashboard";

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
	const [searchParams, { setP, delP }] = useSearchParam(true);

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
		staleTime: Number.POSITIVE_INFINITY,
	});

export const useUserMetadataDetails = (metadataId?: string | null) => {
	return useQuery(getUserMetadataDetailsQuery(metadataId));
};

const useDashboardData = () => {
	const loaderData = useRouteLoaderData<typeof loader>("routes/_dashboard");
	return loaderData;
};

export const useCoreDetails = () => useDashboardData().coreDetails;
export const useUserPreferences = () => useDashboardData().userPreferences;
export const useUserDetails = () => useDashboardData().userDetails;
export const useUserCollections = () => useDashboardData().userCollections;
