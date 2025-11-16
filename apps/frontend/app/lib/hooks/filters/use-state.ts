import { useMemo } from "react";
import { useLocalStorage } from "usehooks-ts";
import { isFilterChanged } from "~/lib/shared/ui-utils";
import type { FilterUpdateFunction } from "~/lib/types";

interface UseFilterStateConfig<TFilter> {
	storageKey: string;
	defaultFilters: TFilter;
}

export const useFilterState = <TFilter extends { page: number; query: string }>(
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

	const updateQuery = (query: string) =>
		setFilters((prev) => ({
			...config.defaultFilters,
			...prev,
			query,
			page: 1,
		}));

	const areFiltersActive = isFilterChanged(
		normalizedFilters,
		config.defaultFilters,
	);

	const resetFilters = () => setFilters(config.defaultFilters);

	return {
		filters,
		updateQuery,
		resetFilters,
		updateFilter,
		setFiltersState,
		areFiltersActive,
		normalizedFilters,
	};
};
