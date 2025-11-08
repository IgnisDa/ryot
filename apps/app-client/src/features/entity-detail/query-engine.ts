import type { ContractClient, ContractRunner, ContractSuccess } from "@/lib/contract-client";

type QueryEngineExecute = ContractClient["queryEngine"]["execute"];
export type QueryEngineResponse = ContractSuccess<QueryEngineExecute>;
export type QueryEngineEntitiesResponse = Extract<QueryEngineResponse, { mode: "entities" }>;
export type QueryEngineEntitiesRequestBody = Extract<
	Parameters<QueryEngineExecute>[0] extends { payload: infer P } ? P : never,
	{ mode: "entities" }
>;
export type QueryEngineRequestBody = Parameters<QueryEngineExecute>[0] extends {
	payload: infer Payload;
}
	? Payload
	: never;
export type QueryEngineEntityItem = QueryEngineEntitiesResponse["data"]["items"][number];

export type QueryEngineClient = (
	payload: QueryEngineEntitiesRequestBody,
) => Promise<QueryEngineEntitiesResponse>;

export function createQueryEngineClient(runContract: ContractRunner): QueryEngineClient {
	return (payload) =>
		runContract((client) => client.queryEngine.execute({ payload })).then((response) => {
			if (response.mode !== "entities") {
				throw new Error("Expected an entity query response");
			}
			return response;
		});
}

async function collectAllPages<T>(
	loadPage: (page: number, items: T[]) => Promise<{ hasNextPage: boolean; items: T[] }>,
) {
	const load = async (page: number, items: T[]): Promise<T[]> => {
		const result = await loadPage(page, items);
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
