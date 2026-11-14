import type { ReactNode } from "react";

import { StatusMessage } from "./status-message";

export type QueryStatusProps<Data> = {
	/** Lower-case noun phrase, e.g. "workout trend". */
	readonly label: string;
	readonly onRetry: () => void;
	readonly children?: undefined | ((data: Data) => ReactNode);
	readonly query: { readonly isError: boolean; readonly data: Data | undefined };
};

export function QueryStatus<Data>({ label, query, onRetry, children }: QueryStatusProps<Data>) {
	const retry = { onClick: onRetry, label: `Retry ${label}` };
	if (query.data === undefined) {
		return query.isError ? (
			<StatusMessage tone="error" action={retry}>
				Could not load {label}.
			</StatusMessage>
		) : (
			<StatusMessage tone="pending">Loading {label}…</StatusMessage>
		);
	}
	return (
		<>
			{query.isError && (
				<StatusMessage tone="error" action={retry}>
					Could not update {label}. Showing the last loaded values.
				</StatusMessage>
			)}
			{children?.(query.data)}
		</>
	);
}
