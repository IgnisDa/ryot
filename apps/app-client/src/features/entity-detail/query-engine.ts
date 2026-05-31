import type { ContractClient, ContractRunner, ContractSuccess } from "@/lib/contract-client";

type QueryEngineExecute = ContractClient["queryEngine"]["execute"];
type RawQueryEngineEntitiesResponse = Extract<QueryEngineResponse, { mode: "entities" }>;
type RawQueryEngineEntityItem = RawQueryEngineEntitiesResponse["data"]["items"][number];

export type QueryEngineRequestBody = Parameters<QueryEngineExecute>[0] extends {
	payload: infer Payload;
}
	? Payload
	: never;
export type QueryEngineResponse = ContractSuccess<QueryEngineExecute>;

export type QueryEngineEntitiesRequestBody = Extract<QueryEngineRequestBody, { mode: "entities" }>;

type QueryEnginePagination = {
	hasNextPage: boolean;
	page: number;
	total: number;
	limit: number;
	totalPages: number;
	hasPreviousPage: boolean;
};

export type QueryEngineEntitiesResponse = Omit<RawQueryEngineEntitiesResponse, "data"> & {
	data: Omit<RawQueryEngineEntitiesResponse["data"], "meta"> & {
		items: ReadonlyArray<RawQueryEngineEntityItem>;
		meta: Omit<RawQueryEngineEntitiesResponse["data"]["meta"], "pagination"> & {
			pagination: QueryEnginePagination;
		};
	};
};

export type QueryEngineEntityItem = RawQueryEngineEntityItem;

export type QueryEngineClient = (
	payload: QueryEngineEntitiesRequestBody,
) => Promise<QueryEngineEntitiesResponse>;

type MaybePromise<T> = T | Promise<T>;

const isQueryEnginePagination = (value: unknown): value is QueryEnginePagination => {
	if (!value || typeof value !== "object") {
		return false;
	}

	const pagination = value as {
		hasNextPage?: unknown;
		page?: unknown;
		total?: unknown;
		limit?: unknown;
		totalPages?: unknown;
		hasPreviousPage?: unknown;
	};

	return (
		["hasNextPage", "page", "total", "limit", "totalPages", "hasPreviousPage"].every(
			(key) => key in value,
		) &&
		typeof pagination.hasNextPage === "boolean" &&
		typeof pagination.page === "number" &&
		typeof pagination.total === "number" &&
		typeof pagination.limit === "number" &&
		typeof pagination.totalPages === "number" &&
		typeof pagination.hasPreviousPage === "boolean"
	);
};

const toQueryEngineEntitiesResponse = (response: QueryEngineResponse) => {
	if (response.mode !== "entities" || !isQueryEnginePagination(response.data.meta.pagination)) {
		throw new Error("Expected an entity query response");
	}

	return {
		...response,
		data: {
			...response.data,
			meta: {
				...response.data.meta,
				pagination: response.data.meta.pagination,
			},
		},
	};
};

export function createQueryEngineClient(runContract: ContractRunner): QueryEngineClient {
	return (payload) =>
		runContract((client) => client.queryEngine.execute({ payload })).then(
			toQueryEngineEntitiesResponse,
		);
}

async function collectAllPages<T>(
	loadPage: (page: number, items: T[]) => MaybePromise<{ hasNextPage: boolean; items: T[] }>,
) {
	const load = async (page: number, items: T[]): Promise<T[]> => {
		const result = await Promise.resolve(loadPage(page, items));
		const nextItems = [...items, ...result.items];
		return result.hasNextPage ? load(page + 1, nextItems) : nextItems;
	};

	return load(1, []);
}

export async function loadQueryEngineEntities<T>(input: {
	queryEngineClient: QueryEngineClient;
	errorMessage: string;
	mapItem: (item: QueryEngineEntityItem, position: number) => T | null;
	requestForPage: (page: number) => QueryEngineEntitiesRequestBody;
}) {
	return collectAllPages<T>(async (page, items) => {
		const responseData = await input.queryEngineClient(input.requestForPage(page)).catch(() => {
			throw new Error(input.errorMessage);
		});

		return {
			hasNextPage: responseData.data.meta.pagination.hasNextPage,
			items: responseData.data.items.flatMap((item, index) => {
				const mapped = input.mapItem(item, items.length + index);
				return mapped ? [mapped] : [];
			}),
		};
	});
}
