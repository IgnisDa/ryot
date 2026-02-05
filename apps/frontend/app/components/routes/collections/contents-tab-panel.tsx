import { ActionIcon, Button, Group, Stack, Text } from "@mantine/core";
import {
	type CollectionContentsQuery,
	CollectionContentsSortBy,
} from "@ryot/generated/graphql/backend/graphql";
import { IconFilter } from "@tabler/icons-react";
import {
	ApplicationPagination,
	DisplayListDetailsAndRefresh,
} from "~/components/common";
import { FilterPresetBar } from "~/components/common/filter-presets";
import {
	DebouncedSearchInput,
	FiltersModal,
} from "~/components/common/filters";
import { ApplicationGrid } from "~/components/common/layout";
import { CollectionItem } from "~/components/routes/collections/collection-item";
import { FiltersModalForm } from "~/components/routes/collections/filters-modal-form";
import type {
	CollectionContents,
	FilterState,
} from "~/components/routes/collections/filters-state";
import type { useFilterPresets } from "~/lib/hooks/filters/use-presets";

export type ContentsTabPanelProps = {
	filters: FilterState;
	isReorderMode: boolean;
	resetFilters: () => void;
	openPresetModal: () => void;
	haveFiltersChanged: boolean;
	filtersModalOpened: boolean;
	openFiltersModal: () => void;
	closeFiltersModal: () => void;
	refreshCollectionContents: () => void;
	details: NonNullable<CollectionContents>;
	setIsReorderMode: (value: boolean) => void;
	contentsPresets: ReturnType<typeof useFilterPresets>;
	updateFilters: (filters: Partial<FilterState>) => void;
	collectionContents: CollectionContentsQuery["collectionContents"] | undefined;
};

export function ContentsTabPanel(props: ContentsTabPanelProps) {
	return (
		<Stack>
			{!props.isReorderMode ? (
				<>
					<Group wrap="nowrap">
						<DebouncedSearchInput
							value={props.filters.query}
							placeholder="Search in the collection"
							onChange={(query) => props.updateFilters({ query })}
						/>
						<ActionIcon
							color={props.haveFiltersChanged ? "blue" : "gray"}
							onClick={() => props.openFiltersModal()}
						>
							<IconFilter size={24} />
						</ActionIcon>
						<FiltersModal
							opened={props.filtersModalOpened}
							resetFilters={props.resetFilters}
							onSavePreset={props.openPresetModal}
							closeFiltersModal={props.closeFiltersModal}
						>
							<FiltersModalForm
								filters={props.filters}
								updateFilter={(key, value) =>
									props.updateFilters({ [key]: value } as Partial<FilterState>)
								}
							/>
						</FiltersModal>
					</Group>
					<FilterPresetBar presetManager={props.contentsPresets} />
					<DisplayListDetailsAndRefresh
						total={props.details.totalItems}
						cacheId={props.collectionContents?.cacheId}
						onRefreshButtonClicked={props.refreshCollectionContents}
						isRandomSortOrderSelected={
							props.filters.sortBy === CollectionContentsSortBy.Random
						}
					/>
				</>
			) : (
				<Group justify="end">
					<Button
						variant="outline"
						onClick={() => props.setIsReorderMode(false)}
					>
						Done Reordering
					</Button>
				</Group>
			)}
			{props.details.results.items.length > 0 ? (
				<ApplicationGrid>
					{props.details.results.items.map((lm, index) => (
						<CollectionItem
							item={lm}
							key={lm.entityId}
							rankNumber={index + 1}
							isReorderMode={props.isReorderMode}
							collectionName={props.details.details.name}
							totalItems={props.details.results.items.length}
						/>
					))}
				</ApplicationGrid>
			) : (
				<Text>You have not added anything to this collection</Text>
			)}
			<ApplicationPagination
				value={props.filters.page}
				totalItems={props.details.results.details.totalItems}
				onChange={(page) => props.updateFilters({ page })}
			/>
		</Stack>
	);
}
