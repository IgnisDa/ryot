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
	type MetadataGroupSearchInput,
	type MetadataSearchInput,
	type PeopleSearchInput,
	PersonDetailsDocument,
	type SearchInput,
	type UserAnalyticsInput,
	type UserCalendarEventInput,
	type UserExercisesListInput,
	type UserMeasurementsListInput,
	UserMetadataDetailsDocument,
	UserMetadataGroupDetailsDocument,
	type UserMetadataGroupsListInput,
	type UserMetadataListInput,
	type UserPeopleListInput,
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
	genreImages: (genreId: string) => ({
		queryKey: ["genreDetails", "images", genreId],
	}),
	userMetadataRecommendations: () => ({
		queryKey: ["userMetadataRecommendations"],
	}),
	personDetails: (personId?: string) => ({
		queryKey: ["personDetails", personId],
	}),
	userGenresList: (input: SearchInput) => ({
		queryKey: ["userGenresList", input],
	}),
	metadataDetails: (metadataId?: string) => ({
		queryKey: ["metadataDetails", metadataId],
	}),
	userPersonDetails: (personId?: string) => ({
		queryKey: ["userPersonDetails", personId],
	}),
	peopleSearch: (input: PeopleSearchInput) => ({
		queryKey: ["peopleSearch", input],
	}),
	genreDetails: (input: GenreDetailsInput) => ({
		queryKey: ["genreDetails", input],
	}),
	userMetadataDetails: (metadataId?: string) => ({
		queryKey: ["userMetadataDetails", metadataId],
	}),
	metadataSearch: (input: MetadataSearchInput) => ({
		queryKey: ["metadataSearch", input],
	}),
	userPeopleList: (input: UserPeopleListInput) => ({
		queryKey: ["userPeopleList", input],
	}),
	metadataGroupDetails: (metadataGroupId?: string) => ({
		queryKey: ["metadataGroupDetails", metadataGroupId],
	}),
	userMetadataList: (input: UserMetadataListInput) => ({
		queryKey: ["userMetadataList", input],
	}),
	userMetadataGroupDetails: (metadataGroupId?: string) => ({
		queryKey: ["userMetadataGroupDetails", metadataGroupId],
	}),
	metadataGroupSearch: (input: MetadataGroupSearchInput) => ({
		queryKey: ["metadataGroupSearch", input],
	}),
	userMetadataGroupsList: (input: UserMetadataGroupsListInput) => ({
		queryKey: ["userMetadataGroupsList", input],
	}),
});

const collectionQueryKeys = createQueryKeys("collections", {
	collectionDetailsImages: (collectionId: string) => ({
		queryKey: ["collectionDetails", "images", collectionId],
	}),
	collectionContents: (input: CollectionContentsInput) => ({
		queryKey: ["collectionContents", input],
	}),
	collectionRecommendations: (input: CollectionRecommendationsInput) => ({
		queryKey: ["collectionRecommendations", input],
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
	userMeasurementsList: (input: UserMeasurementsListInput) => ({
		queryKey: ["userMeasurementsList", input],
	}),
	entityList: (entity: string, filters: UserTemplatesOrWorkoutsListInput) => ({
		queryKey: ["fitnessEntityList", entity, filters],
	}),
});

const miscellaneousQueryKeys = createQueryKeys("miscellaneous", {
	usersList: (query?: string) => ({
		queryKey: ["usersList", query],
	}),
	presignedS3Url: (key: string) => ({
		queryKey: ["presignedS3Url", key],
	}),
	userAnalytics: (input: UserAnalyticsInput) => ({
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
				queryFactory.media.userGenresList._def,
				queryFactory.media.userPeopleList._def,
				queryFactory.media.userMetadataList._def,
				queryFactory.media.userMetadataGroupsList._def,
				queryFactory.media.personDetails(entityId).queryKey,
				queryFactory.media.userPersonDetails(entityId).queryKey,
				queryFactory.media.metadataDetails(entityId).queryKey,
				queryFactory.media.userMetadataDetails(entityId).queryKey,
				queryFactory.media.metadataGroupDetails(entityId).queryKey,
				queryFactory.media.userMetadataGroupDetails(entityId).queryKey,
			].map((q) => queryClient.invalidateQueries({ queryKey: q })),
		);
	}, 1500);
