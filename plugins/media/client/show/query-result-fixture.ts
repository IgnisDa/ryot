import { RyotClientError } from "@ryot-app/client-sdk";
import type { RyotQueryResult } from "@ryot-app/client-sdk/react";

const refetch = () => undefined;

export const rowsResult = (
	items: readonly unknown[],
	pageInfo: {
		readonly limit: number;
		readonly hasMore: boolean;
		readonly nextCursor: string | null;
	},
) => ({ items, pageInfo, type: "rows" as const });

export const pendingQueryResult = <Data>(): RyotQueryResult<Data> => ({
	refetch,
	error: null,
	isError: false,
	data: undefined,
	isPending: true,
	isSuccess: false,
	status: "pending",
	isFetching: false,
});

export const readyQueryResult = <Data>(data: Data): RyotQueryResult<Data> => ({
	data,
	refetch,
	error: null,
	isError: false,
	isSuccess: true,
	isPending: false,
	status: "success",
	isFetching: false,
});

export const errorQueryResult = <Data>(error: Error): RyotQueryResult<Data> => ({
	error,
	refetch,
	isError: true,
	status: "error",
	data: undefined,
	isPending: false,
	isSuccess: false,
	isFetching: false,
});

export const malformedQueryResult = <Data>() =>
	errorQueryResult<Data>(new RyotClientError("malformed-result"));

export const transportErrorQueryResult = <Data>() =>
	errorQueryResult<Data>(new RyotClientError("transport"));
