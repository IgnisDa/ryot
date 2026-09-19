import { useState } from "react";

export function useLatestDefined<Value>(value: Value | undefined) {
	const [latest, setLatest] = useState(value);
	if (value !== undefined && value !== latest) {
		setLatest(value);
	}
	return value ?? latest;
}

export function useLatestListState<Data, State>(
	query: { readonly data: Data | undefined; readonly isError: boolean },
	toState: (data: Data) => State,
) {
	const latest = useLatestDefined(query.data);
	if (latest !== undefined) {
		return toState(latest);
	}
	return query.isError ? ({ status: "failed" } as const) : undefined;
}
