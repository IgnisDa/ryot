import { usePluginLocation, type EntityRendererProps } from "@ryot-app/client-sdk/plugin";
import { useRyotQuery } from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";

import { pokemonDetailQuery, type PokemonDetailData } from "./pokemon-detail-query";
import { PokemonDetails } from "./pokemon-display";
import PokemonTypes from "./pokemon-types";

export type PokemonDetailState =
	| { readonly status: "loading" }
	| { readonly status: "error"; readonly retry: () => void }
	| { readonly status: "ready"; readonly data: PokemonDetailData };

export const PokemonDetailBody = ({ state }: { readonly state: PokemonDetailState }) => {
	if (state.status === "loading") {
		return <StatusMessage tone="pending">Loading Pokemon...</StatusMessage>;
	}
	if (state.status === "error") {
		return (
			<StatusMessage tone="error">
				Unable to load this Pokemon.
				<Button variant="secondary" onClick={state.retry}>
					Try again
				</Button>
			</StatusMessage>
		);
	}
	if (state.data.pokemon === null) {
		return (
			<StatusMessage tone="error">
				{state.data.entitySchemaSlug === null
					? "This entity no longer exists."
					: "This entity is not a Pokemon."}
			</StatusMessage>
		);
	}

	const pokemon = state.data.pokemon;
	return (
		<div className="flex w-full max-w-xl flex-col gap-4 text-text">
			<PokemonTypes name={pokemon.name} types={pokemon.types ?? []} />
			<dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4">
				<dt className="text-text-muted">Pokedex number</dt>
				<dd>{pokemon.pokedexNumber ?? "Unknown"}</dd>
			</dl>
			<div className="rounded-lg border border-border bg-surface p-4">
				<PokemonDetails
					height={pokemon.height}
					weight={pokemon.weight}
					abilities={pokemon.abilities}
				/>
			</div>
		</div>
	);
};

export const PokemonDetail = ({ entityId }: EntityRendererProps) => {
	const result = useRyotQuery(pokemonDetailQuery, { entityId });
	let state: PokemonDetailState = { status: "loading" };
	if (result.status === "error") {
		state = { status: "error", retry: result.refetch };
	} else if (result.data !== undefined) {
		state = { status: "ready", data: result.data };
	}
	const title = state.status === "ready" ? (state.data.pokemon?.name ?? "Pokemon") : "Pokemon";

	return (
		<PluginScreenFrame title={title}>
			<PokemonDetailBody state={state} />
		</PluginScreenFrame>
	);
};

const PokemonDetailPage = () => {
	const location = usePluginLocation();
	if (location.kind !== "entity") {
		return null;
	}
	return (
		<PokemonDetail entityId={location.entityId} entitySchemaSlug={location.entitySchemaSlug} />
	);
};

export default PokemonDetailPage;
