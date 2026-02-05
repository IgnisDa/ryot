import { Divider, Flex, MultiSelect, Select, Stack } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import {
	CollectionContentsSortBy,
	EntityLot,
	type ExerciseFilters,
	MediaGeneralFilter,
	MediaLot,
	MediaSource,
} from "@ryot/generated/graphql/backend/graphql";
import { snakeCase, startCase } from "@ryot/ts-utils";
import {
	CollectionsFilter,
	SortOrderToggle,
} from "~/components/common/filters";
import type { FilterState } from "~/components/routes/collections/filters-state";
import type { FilterUpdateFunction } from "~/lib/hooks/filters/types";
import { dayjsLib, getStartTimeFromRange } from "~/lib/shared/date-utils";
import { useCoreDetails } from "~/lib/shared/hooks";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import { ApplicationTimeRange } from "~/lib/types";

type ExerciseFilterKey =
	| "exerciseTypes"
	| "exerciseLevels"
	| "exerciseForces"
	| "exerciseMuscles"
	| "exerciseMechanics"
	| "exerciseEquipments";

type ExerciseFiltersKey = keyof ExerciseFilters;

const exerciseFilterMapping: Record<
	ExerciseFilterKey,
	{ singularKey: ExerciseFiltersKey; label: string }
> = {
	exerciseTypes: { label: "Types", singularKey: "type" },
	exerciseLevels: { label: "Levels", singularKey: "level" },
	exerciseForces: { label: "Forces", singularKey: "force" },
	exerciseMuscles: { label: "Muscles", singularKey: "muscle" },
	exerciseMechanics: { label: "Mechanics", singularKey: "mechanic" },
	exerciseEquipments: { label: "Equipments", singularKey: "equipment" },
};

export const FiltersModalForm = (props: {
	filters: FilterState;
	updateFilter: FilterUpdateFunction<FilterState>;
}) => {
	const coreDetails = useCoreDetails();

	return (
		<>
			<Flex gap="xs" align="center">
				<Select
					w="100%"
					size="xs"
					value={props.filters.sortBy}
					onChange={(v) =>
						props.updateFilter("sortBy", v as CollectionContentsSortBy)
					}
					data={[
						{
							group: "Sort by",
							items: convertEnumToSelectData(CollectionContentsSortBy),
						},
					]}
				/>
				{props.filters.sortBy !== CollectionContentsSortBy.Random ? (
					<SortOrderToggle
						currentOrder={props.filters.orderBy}
						onOrderChange={(order) => props.updateFilter("orderBy", order)}
					/>
				) : null}
			</Flex>
			<Select
				size="xs"
				clearable
				value={props.filters.entityLot}
				placeholder="Select an entity type"
				onChange={(v) => props.updateFilter("entityLot", v as EntityLot)}
				data={convertEnumToSelectData(
					Object.values(EntityLot).filter(
						(o) =>
							![
								EntityLot.Genre,
								EntityLot.Review,
								EntityLot.Collection,
								EntityLot.UserMeasurement,
							].includes(o),
					),
				)}
			/>
			{props.filters.entityLot === EntityLot.Metadata ||
			props.filters.entityLot === EntityLot.MetadataGroup ? (
				<>
					<Select
						size="xs"
						clearable
						placeholder="Select a media type"
						value={props.filters.metadataLot}
						data={convertEnumToSelectData(MediaLot)}
						onChange={(v) => props.updateFilter("metadataLot", v as MediaLot)}
					/>
					{props.filters.entityLot === EntityLot.Metadata ? (
						<>
							<Select
								size="xs"
								clearable
								placeholder="Select a media source"
								value={props.filters.metadataSource}
								data={convertEnumToSelectData(MediaSource)}
								onChange={(v) =>
									props.updateFilter("metadataSource", v as MediaSource)
								}
							/>
							<Select
								size="xs"
								clearable
								placeholder="Select a general filter"
								value={props.filters.metadataGeneral}
								data={convertEnumToSelectData(MediaGeneralFilter)}
								onChange={(v) =>
									props.updateFilter("metadataGeneral", v as MediaGeneralFilter)
								}
							/>
						</>
					) : null}
				</>
			) : null}
			{props.filters.entityLot === EntityLot.Exercise ? (
				<Stack gap={2}>
					{(Object.keys(exerciseFilterMapping) as Array<ExerciseFilterKey>).map(
						(filterKey) => {
							const { singularKey, label } = exerciseFilterMapping[filterKey];
							const filterData =
								coreDetails.exerciseParameters.filters[singularKey];
							return (
								<MultiSelect
									key={filterKey}
									size="xs"
									clearable
									searchable
									label={label}
									value={props.filters[filterKey]}
									onChange={(v) =>
										props.updateFilter(
											filterKey,
											v as FilterState[ExerciseFilterKey],
										)
									}
									data={filterData.map((value) => ({
										value,
										label: startCase(snakeCase(value)),
									}))}
								/>
							);
						},
					)}
				</Stack>
			) : null}
			<Divider />
			<CollectionsFilter
				applied={props.filters.collections}
				onFiltersChanged={(val) => props.updateFilter("collections", val)}
			/>
			<Divider />
			<Stack gap="xs">
				<Select
					size="xs"
					value={props.filters.dateRange}
					description="Updated between time range"
					data={Object.values(ApplicationTimeRange)}
					onChange={(v) => {
						const range = v as ApplicationTimeRange;
						const startDateRange = getStartTimeFromRange(range);
						props.updateFilter("dateRange", range);
						if (range === ApplicationTimeRange.Custom) return;

						props.updateFilter(
							"startDateRange",
							startDateRange?.format("YYYY-MM-DD") || "",
						);
						props.updateFilter(
							"endDateRange",
							range === ApplicationTimeRange.AllTime
								? ""
								: dayjsLib().format("YYYY-MM-DD"),
						);
					}}
				/>
				{props.filters.dateRange === ApplicationTimeRange.Custom ? (
					<DatePickerInput
						size="xs"
						type="range"
						description="Select custom dates"
						value={
							props.filters.startDateRange && props.filters.endDateRange
								? [
										new Date(props.filters.startDateRange),
										new Date(props.filters.endDateRange),
									]
								: undefined
						}
						onChange={(v) => {
							const start = v[0];
							const end = v[1];
							if (!start || !end) return;
							props.updateFilter(
								"startDateRange",
								dayjsLib(start).format("YYYY-MM-DD"),
							);
							props.updateFilter(
								"endDateRange",
								dayjsLib(end).format("YYYY-MM-DD"),
							);
						}}
					/>
				) : null}
			</Stack>
		</>
	);
};
