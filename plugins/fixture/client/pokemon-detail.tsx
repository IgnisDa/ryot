import { type EntityRendererProps, usePluginLocation } from "@ryot-app/plugin-client-sdk/plugin";
import { useMessages, useRyotQuery, useStampedMessages } from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";

import { catalogMessage } from "../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import { type PokemonDetailData, pokemonDetailQuery } from "./pokemon-detail-query";
import { PokemonDetails } from "./pokemon-display";
import PokemonTypes from "./pokemon-types";

export type PokemonDetailState =
	| { readonly status: "loading" }
	| { readonly status: "error"; readonly retry: () => void }
	| { readonly status: "ready"; readonly data: PokemonDetailData };

export const PokemonDetailBody = ({ state }: { readonly state: PokemonDetailState }) => {
	const text = useMessages(PLUGIN_PACKAGE_ID, catalogMessage);
	if (state.status === "loading") {
		return <StatusMessage tone="pending">{text("pokemon.status.loading")}</StatusMessage>;
	}
	if (state.status === "error") {
		return (
			<StatusMessage tone="error">
				{text("pokemon-detail.load-failed")}
				<Button variant="secondary" onClick={state.retry}>
					{text("common.action.try-again")}
				</Button>
			</StatusMessage>
		);
	}
	if (state.data.pokemon === null) {
		return (
			<StatusMessage tone="error">
				{state.data.entitySchemaSlug === null
					? text("pokemon-detail.entity-missing")
					: text("pokemon-detail.entity-not-pokemon")}
			</StatusMessage>
		);
	}

	const pokemon = state.data.pokemon;
	return (
		<div className="flex w-full max-w-xl flex-col gap-4 text-text">
			<PokemonTypes name={pokemon.name} types={pokemon.types ?? []} />
			<dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4">
				<dt className="text-text-muted">{text("pokemon-detail.pokedex-number")}</dt>
				<dd>{pokemon.pokedexNumber ?? text("common.status.unknown")}</dd>
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
	const message = useStampedMessages(PLUGIN_PACKAGE_ID, catalogMessage);
	const result = useRyotQuery(pokemonDetailQuery, { entityId });
	let state: PokemonDetailState = { status: "loading" };
	if (result.status === "error") {
		state = { status: "error", retry: result.refetch };
	} else if (result.data !== undefined) {
		state = { status: "ready", data: result.data };
	}
	const title =
		state.status === "ready" && state.data.pokemon !== null
			? state.data.pokemon.name
			: message("entity-schema.pokemon.name");

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
