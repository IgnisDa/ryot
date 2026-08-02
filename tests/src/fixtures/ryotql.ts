import type { ContractPayload, ContractSuccess } from "@ryot/contract/client";
import type { RowItem, RowsResult, RyotQLResult } from "@ryot/contract/modules/ryotql/language";
import type { PreparedRecipe } from "@ryot/ryotql";
import { Effect } from "effect";

import { requireString, resultToEffect } from "~/support/assertions";

import type { Client } from "./auth";

export type RyotQLPayload = ContractPayload<"ryotql", "execute">;
export type RyotQLResponse = ContractSuccess<"ryotql", "execute">;

export const executeRyotQL = (client: Client, document: RyotQLPayload) =>
	client.call((contract) => contract.ryotql.execute({ payload: document }));

export const executeRyotQLRecipe = <Success>(client: Client, recipe: PreparedRecipe<Success>) =>
	Effect.gen(function* () {
		const response = yield* executeRyotQL(client, recipe.document);
		return yield* resultToEffect(recipe.decode(response));
	});

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
