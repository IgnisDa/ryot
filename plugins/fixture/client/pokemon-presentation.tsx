import {
	defineEntityPresentation,
	PluginLink,
	type EntityPresentationComponentProps,
	type EntityPresentationLoader,
} from "@ryot-app/client-sdk/plugin";

import {
	pokemonPresentationRecipe,
	type PokemonPresentationData,
} from "./pokemon-presentation-query";
import PokemonTypes from "./pokemon-types";

const loadPokemon: EntityPresentationLoader<PokemonPresentationData> = async ({
	client,
	signal,
	references,
}) => {
	const requestedIds = [...new Set(references.map(({ entityId }) => entityId))];
	const rows = await client.data.query(pokemonPresentationRecipe(requestedIds), { signal });
	return Object.fromEntries(rows.map((row) => [row.id, row]));
};

const PokemonGrid = ({
	data,
	reference,
	viewContext,
}: EntityPresentationComponentProps<PokemonPresentationData>) => (
	<article
		data-layout="grid"
		data-entity-id={reference.entityId}
		data-view-context={JSON.stringify(viewContext)}
		className="grid gap-3 rounded-xl border border-border bg-surface p-4 shadow-card"
	>
		<PluginLink to={{ kind: "entity", entityId: reference.entityId }}>
			<span className="font-display text-lg font-semibold text-text">{data.name}</span>
		</PluginLink>
		<PokemonTypes name={data.name} types={data.types ?? []} />
	</article>
);

const PokemonList = ({
	data,
	reference,
	viewContext,
}: EntityPresentationComponentProps<PokemonPresentationData>) => (
	<article
		data-layout="list"
		data-entity-id={reference.entityId}
		data-view-context={JSON.stringify(viewContext)}
		className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-3"
	>
		<PluginLink to={{ kind: "entity", entityId: reference.entityId }}>
			<span className="font-semibold text-text">{data.name}</span>
		</PluginLink>
		<PokemonTypes name={data.name} types={data.types ?? []} />
	</article>
);

export const pokemonGridPresentation = defineEntityPresentation({
	loader: loadPokemon,
	component: PokemonGrid,
});

export const pokemonListPresentation = defineEntityPresentation({
	loader: loadPokemon,
	component: PokemonList,
});
