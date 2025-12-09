import { isEqual } from "@ryot/ts-utils";
import { type ParserMap, type Values, useQueryStates } from "nuqs";
import { useMemo } from "react";
import { useLocalStorage } from "usehooks-ts";
import type { FilterUpdateFunction } from "./types";

function areFiltersChanged<Parsers extends ParserMap>(
	parsers: Parsers,
	filters: Values<Parsers>,
) {
	for (const [key, parser] of Object.entries(parsers))
		if (
			!["page", "query"].includes(key) &&
			!parser.eq(filters[key], parsers[key].defaultValue)
		)
			return true;
	return false;
}

export function useFiltersState<Parsers extends ParserMap>(config: Parsers) {
	const [filters, setFilters] = useQueryStates(config);
	const haveFiltersChanged = areFiltersChanged(config, filters);

	const resetFilters = () => setFilters(() => null);

	const updateFilters = (nextFilters: Partial<typeof filters>) =>
		setFilters(() => ({ page: 1, ...nextFilters }));

	return { filters, resetFilters, updateFilters, haveFiltersChanged };
}

// FIXME: Remove this
const isFilterChanged = <T extends object>(
	current: T | undefined,
	defaults: T,
) => {
	if (!current) return false;

	return Object.keys(defaults)
		.filter((key) => !["page", "query"].includes(key))
		.some((key) => !isEqual(current[key as keyof T], defaults[key as keyof T]));
};

// FIXME: Remove this
interface UseFilterStateConfig<TFilter> {
	storageKey: string;
	defaultFilters: TFilter;
}

// FIXME: Remove this
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
