import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import type { AuthoredAppSchema } from "@ryot-app/contract/modules/plugins/manifest-text";
import type { RowItem, RowsResult, RyotQLResult } from "@ryot-app/contract/modules/ryotql/language";
import {
	ExecutionRequest,
	PluginExecutionRequest,
	stampExecutionSource,
} from "@ryot-app/contract/modules/ryotql/request";
import type { PluginId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type { Recipe } from "@ryot-app/ryotql";
import { Effect, Schema } from "effect";

import { requireString } from "~/support/assertions";
import { getSharedHarnessTarget, type HarnessTarget } from "~/support/harness-target";

import type { Client } from "./auth";
import { getApiClient } from "./contract-client";

export type RyotQLPayload = ContractPayload<"ryotql", "execute">;
export type RyotQLResponse = ContractSuccess<"ryotql", "execute">;

export const executeRyotQL = (client: Client, request: RyotQLPayload) =>
	client.call((contract) => contract.ryotql.execute({ payload: request }));

type RequestOptions = Omit<RyotQLPayload, "source" | "arguments">;

/** Turns a recipe's inline request into an execution payload for a harness target. */
type RecipeRequest<Error, Requirements> = (
	request: unknown,
	target: HarnessTarget,
) => Effect.Effect<RyotQLPayload, Error, Requirements>;

type RecipePage<Item> = {
	readonly items: ReadonlyArray<Item>;
	readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: null | string };
};

const collectRecipeItems = <Item, Error, Requirements>(
	execute: (after: string | undefined) => Effect.Effect<RecipePage<Item>, Error, Requirements>,
) =>
	Effect.gen(function* () {
		const items: Item[] = [];
		let after: string | undefined;
		let hasMore: boolean;
		do {
			const page = yield* execute(after);
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

const recipeExecutors = <Bound extends AppSchema<unknown>, Error, Requirements>(
	toRequest: RecipeRequest<Error, Requirements>,
) => {
	const request = <Success, Parameters extends Bound>(
		recipe: Recipe<Success, Parameters>,
		arguments_: Recipe.Arguments<Recipe<Success, Parameters>>,
		options: RequestOptions,
		target: HarnessTarget,
	) =>
		toRequest(
			{
				...options,
				arguments: Object.fromEntries(
					Object.entries(arguments_).filter(([, value]) => value !== undefined),
				),
				source: {
					kind: "inline",
					document: recipe.document,
					...(recipe.query === undefined ? {} : { query: recipe.query }),
				},
			},
			target,
		);

	const execute = <Success, const Parameters extends Bound>(
		client: Client,
		recipe: Recipe<Success, Parameters>,
		arguments_: NoInfer<Recipe.Arguments<Recipe<Success, Parameters>>>,
		options: RequestOptions = {},
	) =>
		Effect.gen(function* () {
			const payload = yield* request(recipe, arguments_, options, client.target);
			const response = yield* executeRyotQL(client, payload);
			return yield* Effect.fromResult(recipe.decode(response)).pipe(Effect.orDie);
		});

	const executeAdmin = <Success, const Parameters extends Bound>(
		recipe: Recipe<Success, Parameters>,
		arguments_: NoInfer<Recipe.Arguments<Recipe<Success, Parameters>>>,
		target = getSharedHarnessTarget(),
		options: RequestOptions = {},
	) =>
		Effect.gen(function* () {
			const payload = yield* request(recipe, arguments_, options, target);
			const response = yield* getApiClient(target).adminCall((contract) =>
				contract.adminRyotql.execute({ payload }),
			);
			return yield* Effect.fromResult(recipe.decode(response)).pipe(Effect.orDie);
		});

	return {
		execute,
		executeAdmin,
		collect: <Item, const Parameters extends Bound>(
			client: Client,
			recipe: Recipe<RecipePage<Item>, Parameters>,
			arguments_: NoInfer<Recipe.Arguments<Recipe<RecipePage<Item>, Parameters>>>,
			query: string,
			limit = 100,
		) =>
			collectRecipeItems((after) =>
				execute(client, recipe, arguments_, { pages: { [query]: { after, limit } } }),
			),
		collectAdmin: <Item, const Parameters extends Bound>(
			recipe: Recipe<RecipePage<Item>, Parameters>,
			arguments_: NoInfer<Recipe.Arguments<Recipe<RecipePage<Item>, Parameters>>>,
			query: string,
			target?: HarnessTarget,
			limit = 100,
		) =>
			collectRecipeItems((after) =>
				executeAdmin(recipe, arguments_, target, { pages: { [query]: { after, limit } } }),
			),
	};
};

/** Executes recipes whose parameter text is already display text, such as kernel recipes. */
const kernelRecipes = recipeExecutors<AppSchema, never, never>((request) =>
	Schema.decodeUnknownEffect(ExecutionRequest)(request).pipe(Effect.orDie),
);

export const executeRyotQLRecipe = kernelRecipes.execute;
export const executeAdminRyotQLRecipe = kernelRecipes.executeAdmin;
export const collectRyotQLRecipeItems = kernelRecipes.collect;
export const collectAdminRyotQLRecipeItems = kernelRecipes.collectAdmin;

/**
 * Executes recipes authored in a plugin's code, stamping their manifest text with the plugin's
 * namespace as the kernel client bridge does for the plugin's documents.
 */
export const pluginRecipeExecutors = <Error, Requirements>(
	pluginId: (target: HarnessTarget) => Effect.Effect<PluginId, Error, Requirements>,
) =>
	recipeExecutors<AuthoredAppSchema, Error, Requirements>((request, target) =>
		Effect.gen(function* () {
			const decoded = yield* Schema.decodeUnknownEffect(PluginExecutionRequest)(request).pipe(
				Effect.orDie,
			);
			return { ...decoded, source: stampExecutionSource(yield* pluginId(target), decoded.source) };
		}),
	);

export const requireRows = (result: undefined | RyotQLResult, key: string): RowsResult => {
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

export const executeRyotQLError = (client: Client, request: RyotQLPayload) =>
	Effect.flip(executeRyotQL(client, request));
