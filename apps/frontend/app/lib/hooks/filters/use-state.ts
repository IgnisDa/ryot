import { type ParserMap, type Values, useQueryStates } from "nuqs";

function areFiltersChanged<Parsers extends ParserMap>(
	parsers: Parsers,
	values: Values<Parsers>,
) {
	for (const [key, parser] of Object.entries(parsers)) {
		if (parsers[key].defaultValue === undefined && values[key] !== null)
			return false;
		if (
			!["page", "query"].includes(key) &&
			!parser.eq(values[key], parsers[key].defaultValue)
		)
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
