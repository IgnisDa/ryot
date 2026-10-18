import { Result } from "@ryot-app/plugin-client-sdk/effect";
import type { PluginIdentityReference } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import type { PreparedRecipe } from "@ryot-app/plugin-client-sdk/ryotql";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

export type SectionData<Recipes extends SectionRecipes> = {
	readonly [Key in keyof Recipes]: Recipes[Key] extends PreparedRecipe<infer Success>
		? Success
		: never;
};

type SectionRecipes = Readonly<Record<string, PreparedRecipe<unknown>>>;

const responseData = (response: unknown) =>
	typeof response === "object" &&
	response !== null &&
	"data" in response &&
	typeof response.data === "object" &&
	response.data !== null
		? Object.entries(response.data)
		: [];

/**
 * Runs several recipes as one document, so a section fails and retries as a unit. Each recipe's
 * queries are renamed `<key>.<query>` and handed back to that recipe's own decoder.
 */
const sectionRecipe = <Recipes extends SectionRecipes>(
	recipes: Recipes,
): PreparedRecipe<SectionData<Recipes>> => ({
	document: {
		queries: Object.fromEntries(
			Object.entries(recipes).flatMap(([key, recipe]) =>
				Object.entries(recipe.document.queries).map(([name, query]) => [`${key}.${name}`, query]),
			),
		),
	},
	decode: (response) => {
		const data = responseData(response);
		const decoded = Object.entries(recipes).map(([key, recipe]) => {
			const prefix = `${key}.`;
			const own = data.flatMap(([name, value]) =>
				name.startsWith(prefix) ? [[name.slice(prefix.length), value] as const] : [],
			);
			return Result.map(
				recipe.decode({ data: Object.fromEntries(own) }),
				(value) => [key, value] as const,
			);
		});
		return Result.map(
			Result.all(decoded),
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion
			(entries) => Object.fromEntries(entries) as SectionData<Recipes>,
		);
	},
});

export const createHomeSectionQuery = <Input, Recipes extends SectionRecipes>(
	recipes: (input: Input, reference: PluginIdentityReference) => Recipes,
	visible: (data: SectionData<Recipes>) => readonly string[],
) =>
	createRyotQuery<Input, SectionData<Recipes>>(
		({ input, client }) =>
			client.data.query(sectionRecipe(recipes(input, client.pluginIdentity(PLUGIN_PACKAGE_ID)))),
		{
			entityWatch: ({ data }) => ({
				foreground: [],
				visible: data === undefined ? [] : visible(data),
			}),
		},
	);
