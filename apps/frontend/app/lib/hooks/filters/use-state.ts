import { type ParserMap, type Values, useQueryStates } from "nuqs";

function isDefaultState<Parsers extends ParserMap>(
	parsers: Parsers,
	values: Values<Parsers>,
) {
	for (const [key, parser] of Object.entries(parsers)) {
		if (
			["page", "query"].includes(key) ||
			(parsers[key].defaultValue === undefined && values[key] === null)
		)
			continue;

		if (!parser.eq(values[key], parsers[key].defaultValue)) return false;
	}
	return true;
}

export function useFiltersState<Parsers extends ParserMap>(config: Parsers) {
	const [filters, setFilters] = useQueryStates(config);
	const haveFiltersChanged = !isDefaultState(config, filters);

	const resetFilters = () => setFilters(() => null);

	const updateFilters = (nextFilters: Partial<Values<Parsers>>) =>
		setFilters(() => ({ page: 1, ...nextFilters }));

	return { filters, resetFilters, updateFilters, haveFiltersChanged };
}
