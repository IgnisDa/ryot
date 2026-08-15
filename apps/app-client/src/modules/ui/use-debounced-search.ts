import { useEffect, useState } from "react";

export const SEARCH_DEBOUNCE_MS = 300;

export function useDebouncedSearch(initialQuery = "") {
	const [query, setQuery] = useState(initialQuery);
	const [value, setValue] = useState(initialQuery);

	useEffect(() => {
		const normalized = value.trim();
		if (normalized === query) {
			return undefined;
		}
		const timer = setTimeout(() => setQuery(normalized), SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query, value]);

	return {
		query,
		value,
		onChange: setValue,
		onSubmit: () => setQuery(value.trim()),
		onClear: () => {
			setValue("");
			setQuery("");
		},
	};
}
