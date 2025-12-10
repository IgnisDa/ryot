import { type ParserMap, type Values, useQueryStates } from "nuqs";

function areFiltersChanged<Parsers extends ParserMap>(
	parsers: Parsers,
	values: Values<Parsers>,
) {
	for (const key in parsers) {
		const value = values[key];
		const parser = parsers[key];
		const defaultValue = parser.defaultValue;

		if (defaultValue === undefined && value !== null) return false;
		if (!["page", "query"].includes(key) && !parser.eq(value, defaultValue))
			return true;
	}
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
