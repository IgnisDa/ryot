import { $path } from "@ignisda/remix-routes";
import { useMantineTheme } from "@mantine/core";
import { useNavigate, useSearchParams } from "@remix-run/react";
import {
	MetadataDetailsDocument,
	UserMetadataDetailsDocument,
	UserPreferencesDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { useQuery, skipToken } from "@tanstack/react-query";
import { experimental_createPersister } from "@tanstack/react-query-persist-client";
import { useAtom } from "jotai";
import Cookies from "js-cookie";
import {
	clientGqlService,
	CurrentWorkoutKey,
	getStringAsciiValue,
} from "~/lib/generals";
import { type InProgressWorkout, currentWorkoutAtom } from "~/lib/workout";

export function useGetMantineColor() {
	const theme = useMantineTheme();
	const colors = Object.keys(theme.colors);

	// taken from https://stackoverflow.com/questions/44975435/using-mod-operator-in-javascript-to-wrap-around#comment76926119_44975435
	const getColor = (input: string) =>
		colors[(getStringAsciiValue(input) + colors.length) % colors.length];

	return getColor;
}

export function useSearchParam() {
	const [searchParams, setSearchParams] = useSearchParams();

	const delP = (key: string) => {
		setSearchParams((prev) => {
			prev.delete(key);
			return prev;
		});
	};

	const setP = (key: string, value?: string | null) => {
		setSearchParams((prev) => {
			if (!value) delP(key);
			else prev.set(key, value);
			return prev;
		});
	};

	return [searchParams, { setP, delP }] as const;
}

export function getWorkoutStarter() {
	const navigate = useNavigate();
	const [_, setCurrentWorkout] = useAtom(currentWorkoutAtom);

	const fn = (wkt: InProgressWorkout) => {
		setCurrentWorkout(wkt);
		Cookies.set(CurrentWorkoutKey, "true", {
			expires: 2,
			sameSite: "Strict",
		});
		navigate($path("/fitness/workouts/current"));
	};
	return fn;
}

const createPersister = () =>
	experimental_createPersister({
		storage: typeof window !== "undefined" ? window.localStorage : undefined,
	});

export const useMetadataDetails = (metadataId?: string | null) => {
	return useQuery({
		queryKey: ["metadataDetails", metadataId],
		queryFn: metadataId
			? () =>
					clientGqlService
						.request(MetadataDetailsDocument, { metadataId })
						.then((data) => data.metadataDetails)
			: skipToken,
		persister: createPersister(),
		staleTime: 1000 * 60 * 60 * 20,
	});
};

export const useUserMetadataDetails = (metadataId?: string | null) => {
	return useQuery({
		queryKey: ["userMetadataDetails", metadataId],
		queryFn: metadataId
			? () =>
					clientGqlService
						.request(UserMetadataDetailsDocument, { metadataId })
						.then((data) => data.userMetadataDetails)
			: skipToken,
		persister: createPersister(),
	});
};

export const USER_PREFERENCES_QUERY_KEY = "userPreferences";

export const useUserPreferences = () => {
	return useQuery({
		queryKey: [USER_PREFERENCES_QUERY_KEY],
		queryFn: () =>
			clientGqlService
				.request(UserPreferencesDocument)
				.then((data) => data.userPreferences),
		persister: createPersister(),
		staleTime: Number.POSITIVE_INFINITY,
	});
};
