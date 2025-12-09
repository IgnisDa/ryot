import { isEqual } from "@ryot/ts-utils";
import { useMemo } from "react";
import { useLocalStorage } from "usehooks-ts";
import type { FilterUpdateFunction } from "./types";

const isFilterChanged = <T extends object>(
	current: T | undefined,
	defaults: T,
) => {
	if (!current) return false;

	return Object.keys(defaults)
		.filter((key) => !["page", "query"].includes(key))
		.some((key) => !isEqual(current[key as keyof T], defaults[key as keyof T]));
};

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
		updateQuery,
		resetFilters,
		updateFilter,
		setFiltersState,
		areFiltersActive,
		normalizedFilters,
	};
};
