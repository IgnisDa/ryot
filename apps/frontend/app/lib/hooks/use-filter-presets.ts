import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
	CreateFilterPresetDocument,
	DeleteFilterPresetDocument,
	type FilterPresetContextType,
	FilterPresetsDocument,
	UpdateFilterPresetLastUsedDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { isEqual } from "@ryot/ts-utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClientError } from "graphql-request";
import { useEffect, useRef } from "react";
import { useLocalStorage } from "usehooks-ts";
import { clientGqlService } from "~/lib/shared/react-query";

interface UseFilterPresetsConfig<TFilter> {
	enabled: boolean;
	filters: TFilter;
	storageKeyPrefix: string;
	contextInformation?: unknown;
	contextType: FilterPresetContextType;
	setFilters: (filters: TFilter) => void;
}

export const useFilterPresets = <TFilter extends { page: number }>(
	config: UseFilterPresetsConfig<TFilter>,
) => {
	const [activePresetId, setActivePresetId] = useLocalStorage<string | null>(
		config.storageKeyPrefix,
		null,
	);
	const isApplyingPreset = useRef(false);

	const { data: filterPresets, refetch: refetchFilterPresets } = useQuery({
		enabled: config.enabled,
		queryKey: ["filterPresets", config.contextType, config.contextInformation],
		queryFn: () =>
			clientGqlService
				.request(FilterPresetsDocument, {
					input: {
						contextType: config.contextType,
						contextInformation: config.contextInformation,
					},
				})
				.then((data) => data.filterPresets),
	});

	const createPresetMutation = useMutation({
		mutationFn: (variables: { input: { name: string; filters: unknown } }) =>
			clientGqlService.request(CreateFilterPresetDocument, {
				input: {
					...variables.input,
					contextType: config.contextType,
					contextInformation: config.contextInformation,
				},
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
		config.setFilters({ ...parsedFilters, page: 1 } as TFilter);
		setActivePresetId(presetId);
		setTimeout(() => {
			isApplyingPreset.current = false;
		}, 100);
		updateLastUsedMutation.mutate(presetId);
	};

	const savePreset = async (name: string) => {
		try {
			const filtersToSave = { ...config.filters, page: 1 };
			const result = await createPresetMutation.mutateAsync({
				input: { name, filters: filtersToSave },
			});
			setActivePresetId(result.createFilterPreset.id);
			return result.createFilterPreset.id;
		} catch (error) {
			notifications.show({
				color: "red",
				title: "Error",
				message:
					error instanceof ClientError && error.response.errors?.length
						? error.response.errors[0]?.message
						: "Failed to save filter preset",
			});
			throw error;
		}
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

		const { page: _savedPage, ...savedWithoutPage } = savedFilters;
		const { page: _currentPage, ...filtersWithoutPage } = config.filters;

		if (!isEqual(filtersWithoutPage, savedWithoutPage)) setActivePresetId(null);
	}, [config.filters, activePresetId, filterPresets, setActivePresetId]);

	return {
		savePreset,
		applyPreset,
		deletePreset,
		filterPresets,
		activePresetId,
		refetchFilterPresets,
	};
};
