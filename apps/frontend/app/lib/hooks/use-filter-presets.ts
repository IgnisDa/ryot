import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
	CreateFilterPresetDocument,
	DeleteFilterPresetDocument,
	type FilterPresetContextInformation,
	type FilterPresetContextType,
	FilterPresetsDocument,
	UpdateFilterPresetLastUsedDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { isEqual } from "@ryot/ts-utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocalStorage } from "usehooks-ts";
import { clientGqlService } from "~/lib/shared/react-query";

interface UseFilterPresetsConfig<TFilter> {
	enabled: boolean;
	filters: TFilter;
	storageKeyPrefix: string;
	contextType: FilterPresetContextType;
	setFilters: (filters: TFilter) => void;
	contextInformation: FilterPresetContextInformation;
}

export const useFilterPresets = <TFilter extends { page: number }>(
	config: UseFilterPresetsConfig<TFilter>,
) => {
	const {
		enabled,
		contextType,
		filters,
		setFilters,
		storageKeyPrefix,
		contextInformation,
	} = config;

	const [activePresetId, setActivePresetId] = useLocalStorage<string | null>(
		storageKeyPrefix,
		null,
	);
	const isApplyingPreset = useRef(false);

	const { data: filterPresets, refetch: refetchFilterPresets } = useQuery({
		enabled,
		queryKey: ["filterPresets", contextType, contextInformation],
		queryFn: () =>
			clientGqlService
				.request(FilterPresetsDocument, {
					input: { contextInformation, contextType },
				})
				.then((data) => data.filterPresets),
	});

	const createPresetMutation = useMutation({
		mutationFn: (variables: { input: { name: string; filters: unknown } }) =>
			clientGqlService.request(CreateFilterPresetDocument, {
				input: { ...variables.input, contextType, contextInformation },
			}),
		onSuccess: () => {
			refetchFilterPresets();
			notifications.show({
				color: "green",
				title: "Success",
				message: "Filter preset saved",
			});
		},
	});

	const deletePresetMutation = useMutation({
		mutationFn: (filterPresetId: string) =>
			clientGqlService.request(DeleteFilterPresetDocument, {
				filterPresetId,
			}),
		onSuccess: () => {
			refetchFilterPresets();
			setActivePresetId(null);
			notifications.show({
				color: "green",
				title: "Success",
				message: "Filter preset deleted",
			});
		},
	});

	const updateLastUsedMutation = useMutation({
		onSuccess: () => refetchFilterPresets(),
		mutationFn: (filterPresetId: string) =>
			clientGqlService.request(UpdateFilterPresetLastUsedDocument, {
				filterPresetId,
			}),
	});

	const applyPreset = async (presetId: string, presetFilters: unknown) => {
		isApplyingPreset.current = true;
		const parsedFilters =
			typeof presetFilters === "string"
				? JSON.parse(presetFilters)
				: presetFilters;
		setFilters({ ...parsedFilters, page: 1 } as TFilter);
		setActivePresetId(presetId);
		setTimeout(() => {
			isApplyingPreset.current = false;
		}, 100);
		updateLastUsedMutation.mutate(presetId);
	};

	const savePreset = async (name: string) => {
		const filtersToSave = { ...filters, page: 1 };
		const result = await createPresetMutation.mutateAsync({
			input: { name, filters: filtersToSave },
		});
		setActivePresetId(result.createFilterPreset.id);
		return result.createFilterPreset.id;
	};

	const deletePreset = (presetId: string, presetName: string) => {
		modals.openConfirmModal({
			title: "Delete preset",
			confirmProps: { color: "red" },
			labels: { confirm: "Delete", cancel: "Cancel" },
			onConfirm: () => deletePresetMutation.mutate(presetId),
			children: `Are you sure you want to delete the preset "${presetName}"?`,
		});
	};

	useEffect(() => {
		if (isApplyingPreset.current) return;

		if (!activePresetId || !filterPresets) return;

		const activePreset = filterPresets.response.find(
			(p) => p.id === activePresetId,
		);
		if (!activePreset) return;

		const savedFilters =
			typeof activePreset.filters === "string"
				? JSON.parse(activePreset.filters)
				: activePreset.filters;

		const { page: _currentPage, ...filtersWithoutPage } = filters;
		const { page: _savedPage, ...savedWithoutPage } = savedFilters;

		if (!isEqual(filtersWithoutPage, savedWithoutPage)) setActivePresetId(null);
	}, [filters, activePresetId, filterPresets, setActivePresetId]);

	return {
		savePreset,
		applyPreset,
		deletePreset,
		filterPresets,
		activePresetId,
		refetchFilterPresets,
	};
};
