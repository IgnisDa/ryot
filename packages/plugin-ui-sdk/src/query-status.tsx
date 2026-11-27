import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import type { ReactNode } from "react";

import { StatusMessage } from "./status-message";

export type QueryStatusProps<Data> = {
	readonly onRetry: () => void;
	readonly children?: undefined | ((data: Data) => ReactNode);
	readonly query: { readonly isError: boolean; readonly data: Data | undefined };
};

export function QueryStatus<Data>({ query, onRetry, children }: QueryStatusProps<Data>) {
	const t = useT();
	const retry = { onClick: onRetry, label: t(kernelMessage("common.action.retry")) };
	if (query.data === undefined) {
		return query.isError ? (
			<StatusMessage blocked tone="error" action={retry}>
				{t(kernelMessage("ui.query-status.load-failed"))}
			</StatusMessage>
		) : (
			<StatusMessage blocked tone="pending">
				{t(kernelMessage("common.status.loading"))}
			</StatusMessage>
		);
	}
	return (
		<>
			{query.isError && (
				<StatusMessage tone="error" action={retry}>
					{t(kernelMessage("ui.query-status.refresh-failed"))}
				</StatusMessage>
			)}
			{children?.(query.data)}
		</>
	);
}
