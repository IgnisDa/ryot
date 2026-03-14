import type { paths } from "@ryot/generated/openapi/app-backend";

type QueryEngineRequestBody = NonNullable<
	paths["/query-engine/execute"]["post"]["requestBody"]
>["content"]["application/json"];
type QueryEngineResponse =
	paths["/query-engine/execute"]["post"]["responses"][200]["content"]["application/json"];

export type QueryEngineEntityItem = Extract<
	QueryEngineResponse,
	{ mode: "entities" }
>["data"]["items"][number];

export type QueryEngineClient = {
	POST: (
		path: "/query-engine/execute",
		options: { body: QueryEngineRequestBody },
	) => Promise<{ data?: QueryEngineResponse; error?: unknown }>;
};

type MaybePromise<T> = T | Promise<T>;

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
	apiClient: QueryEngineClient;
	errorMessage: string;
	mapItem: (item: QueryEngineEntityItem, position: number) => T | null;
	requestForPage: (page: number) => QueryEngineRequestBody;
}) {
	return collectAllPages<T>(async (page, items) => {
		const response = await input.apiClient.POST("/query-engine/execute", {
			body: input.requestForPage(page),
		});

		const responseData = response.data;
		if (response.error || responseData?.mode !== "entities") {
			throw new Error(input.errorMessage);
		}

		return {
			hasNextPage: responseData.data.meta.pagination.hasNextPage,
			items: responseData.data.items.flatMap((item, index) => {
				const mapped = input.mapItem(item, items.length + index);
				return mapped ? [mapped] : [];
			}),
		};
	});
}
