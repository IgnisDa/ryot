import {
	createQueryKeys,
	mergeQueryKeys,
} from "@lukemorales/query-key-factory";
import {
	type CollectionContentsInput,
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
	type UserTemplatesOrWorkoutsListInput,
} from "@ryot/generated/graphql/backend/graphql";
import { QueryClient, queryOptions, skipToken } from "@tanstack/react-query";
import { GraphQLClient } from "graphql-request";
import Cookies from "js-cookie";
import { FRONTEND_AUTH_COOKIE_NAME, applicationBaseUrl } from "./constants";

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: Number.POSITIVE_INFINITY,
			placeholderData: (prev: unknown) => prev,
		},
	},
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

const calendarQueryKeys = createQueryKeys("calendar", {
	userCalendarEvents: (input: UserCalendarEventInput) => ({
		queryKey: ["userCalendarEvents", input],
	}),
});

const mediaQueryKeys = createQueryKeys("media", {
	trendingMetadata: () => ({
		queryKey: ["trendingMetadata"],
	}),
	userGenresList: (input: SearchInput) => ({
		queryKey: ["userGenresList", input],
	}),
	personDetails: (personId?: string) => ({
		queryKey: ["personDetails", personId],
	}),
	metadataDetails: (metadataId?: string) => ({
		queryKey: ["metadataDetails", metadataId],
	}),
	userMetadataRecommendations: () => ({
		queryKey: ["userMetadataRecommendations"],
	}),
	userPersonDetails: (personId?: string) => ({
		queryKey: ["userPersonDetails", personId],
	}),
	genreDetails: (input: GenreDetailsInput) => ({
		queryKey: ["genreDetails", input],
	}),
	userMetadataDetails: (metadataId?: string) => ({
		queryKey: ["userMetadataDetails", metadataId],
	}),
	genreImages: (genreId: string) => ({
		queryKey: ["genreDetails", "images", genreId],
	}),
	metadataGroupDetails: (metadataGroupId?: string) => ({
		queryKey: ["metadataGroupDetails", metadataGroupId],
	}),
	userMetadataGroupDetails: (metadataGroupId?: string) => ({
		queryKey: ["userMetadataGroupDetails", metadataGroupId],
	}),
});

const collectionQueryKeys = createQueryKeys("collections", {
	contents: (input: CollectionContentsInput) => ({
		queryKey: ["collectionContents", input],
	}),
	recommendations: (input: CollectionRecommendationsInput) => ({
		queryKey: ["collectionRecommendations", input],
	}),
	images: (collectionId: string) => ({
		queryKey: ["collectionDetails", "images", collectionId],
	}),
});

const fitnessQueryKeys = createQueryKeys("fitness", {
	workoutDetails: (workoutId: string) => ({
		queryKey: ["workoutDetails", workoutId],
	}),
	exerciseDetails: (exerciseId: string) => ({
		queryKey: ["exerciseDetails", exerciseId],
	}),
	userExerciseDetails: (exerciseId: string) => ({
		queryKey: ["userExerciseDetails", exerciseId],
	}),
	userExercisesList: (input: UserExercisesListInput) => ({
		queryKey: ["userExercisesList", input],
	}),
	workoutTemplateDetails: (workoutTemplateId: string) => ({
		queryKey: ["workoutTemplateDetails", workoutTemplateId],
	}),
	entityList: (entity: string, filters: UserTemplatesOrWorkoutsListInput) => ({
		queryKey: ["fitnessEntityList", entity, filters],
	}),
});

const miscellaneousQueryKeys = createQueryKeys("miscellaneous", {
	usersList: () => ({
		queryKey: ["usersList"],
	}),
	presignedS3Url: (key: string) => ({
		queryKey: ["presignedS3Url", key],
	}),
	userAnalytics: (input: UserAnalyticsQueryVariables) => ({
		queryKey: ["userAnalytics", input],
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
				queryFactory.media.personDetails(entityId).queryKey,
				queryFactory.media.userPersonDetails(entityId).queryKey,
				queryFactory.media.metadataDetails(entityId).queryKey,
				queryFactory.media.userMetadataDetails(entityId).queryKey,
				queryFactory.media.metadataGroupDetails(entityId).queryKey,
				queryFactory.media.userMetadataGroupDetails(entityId).queryKey,
			].map((q) => queryClient.invalidateQueries({ queryKey: q })),
		);
	}, 1500);
