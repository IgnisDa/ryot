import {
	createQueryKeys,
	mergeQueryKeys,
} from "@lukemorales/query-key-factory";
import {
	type CollectionRecommendationsInput,
	type GenreDetailsInput,
	MetadataDetailsDocument,
	MetadataGroupDetailsDocument,
	PersonDetailsDocument,
	type SearchInput,
	type UserAnalyticsQueryVariables,
	type UserCalendarEventInput,
	type UserExercisesListInput,
	UserMetadataDetailsDocument,
	UserMetadataGroupDetailsDocument,
	UserPersonDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { QueryClient, queryOptions, skipToken } from "@tanstack/react-query";
import { GraphQLClient } from "graphql-request";
import Cookies from "js-cookie";
import { FRONTEND_AUTH_COOKIE_NAME, applicationBaseUrl } from "./constants";

export const queryClient = new QueryClient({
	defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
});

export const clientGqlService = new GraphQLClient(
	`${applicationBaseUrl}/backend/graphql`,
	{
		headers: () => {
			const data = Cookies.get(FRONTEND_AUTH_COOKIE_NAME);
			return { authorization: data ? `Bearer ${data}` : "" };
		},
	},
);

const mediaQueryKeys = createQueryKeys("media", {
	metadataDetails: (metadataId?: string) => ({
		queryKey: ["metadataDetails", metadataId],
	}),
	userMetadataDetails: (metadataId?: string) => ({
		queryKey: ["userMetadataDetails", metadataId],
	}),
	metadataGroupDetails: (metadataGroupId?: string) => ({
		queryKey: ["metadataGroupDetails", metadataGroupId],
	}),
	userMetadataGroupDetails: (metadataGroupId?: string) => ({
		queryKey: ["userMetadataGroupDetails", metadataGroupId],
	}),
	personDetails: (personId?: string) => ({
		queryKey: ["personDetails", personId],
	}),
	userPersonDetails: (personId?: string) => ({
		queryKey: ["userPersonDetails", personId],
	}),
	genreDetails: (input: GenreDetailsInput) => ({
		queryKey: ["genreDetails", input],
	}),
	genreImages: (genreId: string) => ({
		queryKey: ["genreDetails", "images", genreId],
	}),
	userGenresList: (input: SearchInput) => ({
		queryKey: ["userGenresList", input],
	}),
	trendingMetadata: () => ({
		queryKey: ["trendingMetadata"],
	}),
	userMetadataRecommendations: () => ({
		queryKey: ["userMetadataRecommendations"],
	}),
});

const collectionQueryKeys = createQueryKeys("collections", {
	images: (collectionId: string) => ({
		queryKey: ["collectionDetails", "images", collectionId],
	}),
	recommendations: (input: CollectionRecommendationsInput) => ({
		queryKey: ["collectionRecommendations", input],
	}),
});

const fitnessQueryKeys = createQueryKeys("fitness", {
	exerciseDetails: (exerciseId: string) => ({
		queryKey: ["exerciseDetails", exerciseId],
	}),
	userExerciseDetails: (exerciseId: string) => ({
		queryKey: ["userExerciseDetails", exerciseId],
	}),
	userExercisesList: (input: UserExercisesListInput) => ({
		queryKey: ["userExercisesList", input],
	}),
	workoutDetails: (workoutId: string) => ({
		queryKey: ["workoutDetails", workoutId],
	}),
	workoutTemplateDetails: (workoutTemplateId: string) => ({
		queryKey: ["workoutTemplateDetails", workoutTemplateId],
	}),
});

const miscellaneousQueryKeys = createQueryKeys("miscellaneous", {
	userAnalytics: (input: UserAnalyticsQueryVariables) => ({
		queryKey: ["userAnalytics", input],
	}),
	presignedS3Url: (key: string) => ({
		queryKey: ["presignedS3Url", key],
	}),
});

const calendarQueryKeys = createQueryKeys("calendar", {
	userCalendarEvents: (input: UserCalendarEventInput) => ({
		queryKey: ["userCalendarEvents", input],
	}),
});

export const queryFactory = mergeQueryKeys(
	mediaQueryKeys,
	fitnessQueryKeys,
	calendarQueryKeys,
	collectionQueryKeys,
	miscellaneousQueryKeys,
);

export const getMetadataDetailsQuery = (metadataId?: string) =>
	queryOptions({
		queryKey: queryFactory.media.metadataDetails(metadataId).queryKey,
		queryFn: metadataId
			? () =>
					clientGqlService
						.request(MetadataDetailsDocument, { metadataId })
						.then((data) => data.metadataDetails)
			: skipToken,
	});

export const getUserMetadataDetailsQuery = (metadataId?: string) =>
	queryOptions({
		queryKey: queryFactory.media.userMetadataDetails(metadataId).queryKey,
		queryFn: metadataId
			? () =>
					clientGqlService
						.request(UserMetadataDetailsDocument, { metadataId })
						.then((data) => data.userMetadataDetails)
			: skipToken,
	});

export const getPersonDetailsQuery = (personId?: string) =>
	queryOptions({
		queryKey: queryFactory.media.personDetails(personId).queryKey,
		queryFn: personId
			? () =>
					clientGqlService
						.request(PersonDetailsDocument, { personId })
						.then((data) => data.personDetails)
			: skipToken,
	});

export const getUserPersonDetailsQuery = (personId?: string) =>
	queryOptions({
		queryKey: queryFactory.media.userPersonDetails(personId).queryKey,
		queryFn: personId
			? () =>
					clientGqlService
						.request(UserPersonDetailsDocument, { personId })
						.then((data) => data.userPersonDetails)
			: skipToken,
	});

export const getMetadataGroupDetailsQuery = (metadataGroupId?: string) =>
	queryOptions({
		queryKey: queryFactory.media.metadataGroupDetails(metadataGroupId).queryKey,
		queryFn: metadataGroupId
			? () =>
					clientGqlService
						.request(MetadataGroupDetailsDocument, { metadataGroupId })
						.then((data) => data.metadataGroupDetails)
			: skipToken,
	});

export const getUserMetadataGroupDetailsQuery = (metadataGroupId?: string) =>
	queryOptions({
		queryKey:
			queryFactory.media.userMetadataGroupDetails(metadataGroupId).queryKey,
		queryFn: metadataGroupId
			? () =>
					clientGqlService
						.request(UserMetadataGroupDetailsDocument, { metadataGroupId })
						.then((data) => data.userMetadataGroupDetails)
			: skipToken,
	});

export const refreshEntityDetails = (entityId: string) =>
	setTimeout(async () => {
		await Promise.all(
			[
				queryFactory.media.userMetadataDetails(entityId).queryKey,
				queryFactory.media.metadataDetails(entityId).queryKey,
				queryFactory.media.userMetadataGroupDetails(entityId).queryKey,
				queryFactory.media.metadataGroupDetails(entityId).queryKey,
				queryFactory.media.userPersonDetails(entityId).queryKey,
				queryFactory.media.personDetails(entityId).queryKey,
			].map((q) => queryClient.invalidateQueries({ queryKey: q })),
		);
	}, 1500);
