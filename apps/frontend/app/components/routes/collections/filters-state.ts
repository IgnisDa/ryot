import {
	type CollectionContentsQuery,
	CollectionContentsSortBy,
	EntityLot,
	ExerciseEquipment,
	ExerciseForce,
	ExerciseLevel,
	ExerciseLot,
	ExerciseMechanic,
	ExerciseMuscle,
	GraphqlSortOrder,
	MediaGeneralFilter,
	MediaLot,
	MediaSource,
} from "@ryot/generated/graphql/backend/graphql";
import {
	type inferParserType,
	parseAsArrayOf,
	parseAsInteger,
	parseAsString,
	parseAsStringEnum,
} from "nuqs";
import { parseAsCollectionsFilter } from "~/lib/shared/validation";
import { ApplicationTimeRange } from "~/lib/types";

export type CollectionContents =
	CollectionContentsQuery["collectionContents"]["response"];

export const defaultQueryState = {
	page: parseAsInteger.withDefault(1),
	query: parseAsString.withDefault(""),
	endDateRange: parseAsString.withDefault(""),
	startDateRange: parseAsString.withDefault(""),
	collections: parseAsCollectionsFilter.withDefault([]),
	entityLot: parseAsStringEnum(Object.values(EntityLot)),
	metadataLot: parseAsStringEnum(Object.values(MediaLot)),
	metadataSource: parseAsStringEnum(Object.values(MediaSource)),
	metadataGeneral: parseAsStringEnum(Object.values(MediaGeneralFilter)),
	orderBy: parseAsStringEnum(Object.values(GraphqlSortOrder)).withDefault(
		GraphqlSortOrder.Desc,
	),
	sortBy: parseAsStringEnum(
		Object.values(CollectionContentsSortBy),
	).withDefault(CollectionContentsSortBy.LastUpdatedOn),
	dateRange: parseAsStringEnum(Object.values(ApplicationTimeRange)).withDefault(
		ApplicationTimeRange.AllTime,
	),
	exerciseTypes: parseAsArrayOf(
		parseAsStringEnum(Object.values(ExerciseLot)),
	).withDefault([]),
	exerciseLevels: parseAsArrayOf(
		parseAsStringEnum(Object.values(ExerciseLevel)),
	).withDefault([]),
	exerciseForces: parseAsArrayOf(
		parseAsStringEnum(Object.values(ExerciseForce)),
	).withDefault([]),
	exerciseMuscles: parseAsArrayOf(
		parseAsStringEnum(Object.values(ExerciseMuscle)),
	).withDefault([]),
	exerciseMechanics: parseAsArrayOf(
		parseAsStringEnum(Object.values(ExerciseMechanic)),
	).withDefault([]),
	exerciseEquipments: parseAsArrayOf(
		parseAsStringEnum(Object.values(ExerciseEquipment)),
	).withDefault([]),
};

export type FilterState = inferParserType<typeof defaultQueryState>;
