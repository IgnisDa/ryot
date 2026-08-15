import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import type { RowItem, RowsResult, RyotQLResult } from "@ryot-app/contract/modules/ryotql/language";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Effect } from "effect";

import { requireString, resultToEffect } from "~/support/assertions";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getApiClient } from "./contract-client";

export type RyotQLPayload = ContractPayload<"ryotql", "execute">;
export type RyotQLResponse = ContractSuccess<"ryotql", "execute">;

export const executeRyotQL = (client: Client, document: RyotQLPayload) =>
	client.call((contract) => contract.ryotql.execute({ payload: document }));

export const executeRyotQLRecipe = <Success>(client: Client, recipe: PreparedRecipe<Success>) =>
	Effect.gen(function* () {
		const response = yield* executeRyotQL(client, recipe.document);
		return yield* resultToEffect(recipe.decode(response)).pipe(Effect.orDie);
	});

export const executeAdminRyotQLRecipe = <Success>(
	recipe: PreparedRecipe<Success>,
	baseUrl?: string,
) =>
	Effect.gen(function* () {
		const response = yield* getApiClient(baseUrl).call(
			(contract) => contract.adminRyotql.execute({ payload: recipe.document }),
			adminHeaders(),
		);
		return yield* resultToEffect(recipe.decode(response)).pipe(Effect.orDie);
	});

type RecipePage<Item> = {
	readonly items: ReadonlyArray<Item>;
	readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
};

type PagedRecipe<Item> = (after: string | undefined) => PreparedRecipe<RecipePage<Item>>;

const collectRecipeItems = <Item, Error>(
	recipe: PagedRecipe<Item>,
	execute: (prepared: PreparedRecipe<RecipePage<Item>>) => Effect.Effect<RecipePage<Item>, Error>,
) =>
	Effect.gen(function* () {
		const items: Item[] = [];
		let after: string | undefined;
		let hasMore: boolean;
		do {
			const page = yield* execute(recipe(after));
			items.push(...page.items);
			hasMore = page.pageInfo.hasMore;
			if (hasMore) {
				if (page.pageInfo.nextCursor === null) {
					throw new Error("Paginated RyotQL recipe has more items but no next cursor");
				}
				after = page.pageInfo.nextCursor;
			}
		} while (hasMore);
		return items;
	});

export const collectRyotQLRecipeItems = <Item>(client: Client, recipe: PagedRecipe<Item>) =>
	collectRecipeItems(recipe, (prepared) => executeRyotQLRecipe(client, prepared));

export const collectAdminRyotQLRecipeItems = <Item>(recipe: PagedRecipe<Item>, baseUrl?: string) =>
	collectRecipeItems(recipe, (prepared) => executeAdminRyotQLRecipe(prepared, baseUrl));

export const requireRows = (result: RyotQLResult | undefined, key: string): RowsResult => {
	if (result?.type !== "rows") {
		throw new Error(`Expected '${key}' rows`);
	}
	return result;
};

export const requireRyotQLValue = (item: RowItem, key: string): unknown => {
	if (!(key in item)) {
		throw new Error(`Expected field '${key}'`);
	}
	return item[key];
};

export const requireRyotQLText = (item: RowItem, key: string) =>
	requireString(requireRyotQLValue(item, key), `Expected '${key}' to contain text`);

export const requireRyotQLDate = (item: RowItem, key: string) =>
	requireString(requireRyotQLValue(item, key), `Expected '${key}' to contain a date`);

export const executeRyotQLError = (client: Client, document: RyotQLPayload) =>
	Effect.flip(executeRyotQL(client, document));
