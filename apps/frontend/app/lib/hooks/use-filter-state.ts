import { useMemo } from "react";
import { useLocalStorage } from "usehooks-ts";
import { isFilterChanged } from "~/lib/shared/ui-utils";
import type { FilterUpdateFunction } from "~/lib/types";

interface UseFilterStateConfig<TFilter> {
	storageKey: string;
	defaultFilters: TFilter;
}

export const useFilterState = <TFilter extends { page: number }>(
	config: UseFilterStateConfig<TFilter>,
) => {
	const [filters, setFilters] = useLocalStorage<TFilter>(
		config.storageKey,
		config.defaultFilters,
	);

	const normalizedFilters = useMemo(
		() => ({ ...config.defaultFilters, ...filters }),
		[filters, config.defaultFilters],
	);

	const setFiltersState = (nextFilters: TFilter) =>
		setFilters({ ...config.defaultFilters, ...nextFilters });

	const updateFilter: FilterUpdateFunction<TFilter> = (key, value) =>
		setFilters((prev) => ({
			...config.defaultFilters,
			...prev,
			[key]: value,
		}));

	const areFiltersActive = isFilterChanged(
		normalizedFilters,
		config.defaultFilters,
	);

	const resetFilters = () => setFilters(config.defaultFilters);

	return {
		filters,
		setFilters,
		resetFilters,
		updateFilter,
		setFiltersState,
		areFiltersActive,
		normalizedFilters,
	};
};
