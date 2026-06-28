import type { ManagedAssetLocator } from "@ryot-app/client-sdk";
import {
	defineEntityPresentation,
	PluginLink,
	useRyotViewport,
	type EntityPresentationComponentProps,
	type EntityPresentationLoader,
} from "@ryot-app/client-sdk/plugin";
import { ManagedAssetProvider } from "@ryot-app/client-sdk/react";
import { Button } from "@ryot-app/client-ui-sdk";
import { fieldSyncState, isTitleProvisional, SyncPip } from "@ryot-app/client-ui-sdk/sync";
import { useState } from "react";

import { PokemonArtwork, PokemonDetails } from "./pokemon-display";
import {
	pokemonPresentationRecipe,
	type PokemonPresentationData,
} from "./pokemon-presentation-query";
import PokemonTypes from "./pokemon-types";

export type PokemonPresentationViewData = PokemonPresentationData & {
	readonly batchAssets: readonly ManagedAssetLocator[];
};

export const loadPokemonPresentations: EntityPresentationLoader<
	PokemonPresentationViewData
> = async ({ client, signal, references }) => {
	const requestedIds = [...new Set(references.map(({ entityId }) => entityId))];
	const rows = await client.data.query(pokemonPresentationRecipe(requestedIds), { signal });
	const batchAssets = [
		...new Map(
			rows
				.flatMap(({ artwork }) => artwork?.slice(0, 1) ?? [])
				.filter((asset): asset is ManagedAssetLocator => asset.type !== "remote")
				.map((asset) => [`${asset.type}:${asset.key}`, asset]),
		).values(),
	];
	return Object.fromEntries(rows.map((row) => [row.id, { ...row, batchAssets }]));
};

const PokemonExpandedDetails = ({
	data,
	layout,
	entityId,
}: {
	readonly entityId: string;
	readonly layout: "card" | "row";
	readonly data: PokemonPresentationViewData;
}) => {
	const [expanded, setExpanded] = useState(false);
	const detailsId = `pokemon-${layout}-${entityId}-details`;
	return (
		<div className="grid gap-2">
			<Button
				type="button"
				variant="secondary"
				aria-expanded={expanded}
				aria-controls={detailsId}
				onClick={() => setExpanded((value) => !value)}
				className="justify-self-start px-3 py-1.5 text-sm"
			>
				{expanded ? "Hide details" : "Show details"}
			</Button>
			{expanded && (
				<div id={detailsId} className="rounded-lg bg-surface-2 p-3 text-text">
					<PokemonDetails height={data.height} weight={data.weight} abilities={data.abilities} />
				</div>
			)}
		</div>
	);
};

export const PokemonCard = ({
	data,
	reference,
	viewContext,
}: EntityPresentationComponentProps<PokemonPresentationViewData>) => {
	const { compact } = useRyotViewport();
	return (
		<ManagedAssetProvider assets={data.batchAssets}>
			<article
				data-layout="card"
				data-compact={compact}
				data-entity-id={reference.entityId}
				data-view-context={JSON.stringify(viewContext)}
				className={`grid min-w-0 gap-3 ${compact ? "py-3" : "py-4"}`}
			>
				<PokemonArtwork
					name={data.name}
					asset={data.artwork?.[0]}
					className="aspect-square w-full"
					state={fieldSyncState(data.artwork, reference)}
				/>
				<span className="flex min-w-0 items-baseline gap-1.5">
					<PluginLink to={{ kind: "entity", entityId: reference.entityId }}>
						<span className="font-display text-lg font-semibold text-text">{data.name}</span>
					</PluginLink>
					{isTitleProvisional(reference) && <SyncPip reason="translating" />}
				</span>
				<PokemonTypes name={data.name} types={data.types ?? []} />
				<PokemonExpandedDetails data={data} layout="card" entityId={reference.entityId} />
			</article>
		</ManagedAssetProvider>
	);
};

export const PokemonRow = ({
	data,
	reference,
	viewContext,
}: EntityPresentationComponentProps<PokemonPresentationViewData>) => {
	const { compact } = useRyotViewport();
	return (
		<ManagedAssetProvider assets={data.batchAssets}>
			<article
				data-layout="row"
				data-compact={compact}
				data-entity-id={reference.entityId}
				data-view-context={JSON.stringify(viewContext)}
				className={`flex min-w-0 flex-wrap gap-3 border-b border-border py-3 ${compact ? "items-start" : "items-center"}`}
			>
				<PokemonArtwork
					name={data.name}
					asset={data.artwork?.[0]}
					state={fieldSyncState(data.artwork, reference)}
					className={compact ? "size-14 shrink-0" : "size-16 shrink-0"}
				/>
				<div className="grid min-w-40 flex-1 gap-2">
					<span className="flex min-w-0 items-baseline gap-1.5">
						<PluginLink to={{ kind: "entity", entityId: reference.entityId }}>
							<span className="font-semibold text-text">{data.name}</span>
						</PluginLink>
						{isTitleProvisional(reference) && <SyncPip reason="translating" />}
					</span>
					<PokemonTypes name={data.name} types={data.types ?? []} />
				</div>
				<div className="w-full min-w-0">
					<PokemonExpandedDetails data={data} layout="row" entityId={reference.entityId} />
				</div>
			</article>
		</ManagedAssetProvider>
	);
};

export const pokemonCardPresentation = defineEntityPresentation({
	component: PokemonCard,
	loader: loadPokemonPresentations,
});

export const pokemonRowPresentation = defineEntityPresentation({
	component: PokemonRow,
	loader: loadPokemonPresentations,
});
