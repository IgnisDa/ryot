import type { ManagedAssetLocator } from "@ryot-app/client-sdk";
import { Result } from "@ryot-app/client-sdk/effect";
import {
	defineEntityPresentation,
	PluginLink,
	useRyotViewport,
	type EntityPresentationComponentProps,
	type EntityPresentationLoader,
	type EntityPresentationPrepare,
	type EntityReference,
} from "@ryot-app/client-sdk/plugin";
import { ManagedAssetProvider } from "@ryot-app/client-sdk/react";
import { defineRecipe } from "@ryot-app/client-sdk/ryotql";
import { Button } from "@ryot-app/client-ui-sdk";
import { fieldSyncState, isTitleProvisional, SyncPip } from "@ryot-app/client-ui-sdk/sync";
import { useState } from "react";

import {
	pokemonPresentationSource,
	type PokemonPresentationSourceData,
} from "../shared/entity-presentations";
import { PokemonArtwork, PokemonDetails } from "./pokemon-display";
import PokemonTypes from "./pokemon-types";

export type PokemonPresentationViewData = {
	readonly abilities: PokemonPresentationSourceData["presentationAbilities"];
	readonly artwork: PokemonPresentationSourceData["presentationArtwork"];
	readonly batchAssets: readonly ManagedAssetLocator[];
	readonly height: PokemonPresentationSourceData["presentationHeight"];
	readonly name: string;
	readonly types: PokemonPresentationSourceData["presentationTypes"];
	readonly weight: PokemonPresentationSourceData["presentationWeight"];
};

const buildPokemonPresentations = (
	references: readonly EntityReference[],
	sources: readonly PokemonPresentationSourceData[],
) => {
	const byId = new Map(sources.map((source) => [source.presentationId, source]));
	return Result.map(
		Result.all(
			references.map((reference) => {
				const source = byId.get(reference.entityId);
				return source === undefined
					? Result.fail(
							new Error(`Missing Pokemon presentation source for '${reference.entityId}'`),
						)
					: Result.succeed(source);
			}),
		),
		(rows) => {
			const batchAssets = [
				...new Map(
					rows
						.map(({ presentationArtwork }) => presentationArtwork)
						.filter(
							(asset): asset is ManagedAssetLocator => asset !== null && asset.type !== "remote",
						)
						.map((asset) => [`${asset.type}:${asset.key}`, asset]),
				).values(),
			];
			return Object.fromEntries(
				rows.map((source) => [
					source.presentationId,
					{
						batchAssets,
						name: source.presentationName,
						types: source.presentationTypes,
						height: source.presentationHeight,
						weight: source.presentationWeight,
						artwork: source.presentationArtwork,
						abilities: source.presentationAbilities,
					},
				]),
			);
		},
	);
};

export const preparePokemonPresentations: EntityPresentationPrepare<
	PokemonPresentationViewData
> = ({ sources, references }) => {
	const source = pokemonPresentationSource();
	return Result.flatMap(
		Result.all(references.map((reference) => source.decode(sources.get(reference.entityId)))),
		(rows) => buildPokemonPresentations(references, rows),
	);
};

export const loadPokemonPresentations: EntityPresentationLoader<PokemonPresentationViewData> = ({
	client,
	references,
}) => {
	const source = pokemonPresentationSource();
	const entityIds = [...new Set(references.map(({ entityId }) => entityId))];
	const recipe = defineRecipe(() => ({
		queries: { presentations: source.query(entityIds) },
		map: ({ presentations }) => buildPokemonPresentations(references, presentations.items),
	}))();
	return client.data.query(recipe);
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
					className="aspect-square w-full"
					asset={data.artwork ?? undefined}
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
					asset={data.artwork ?? undefined}
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
	prepare: preparePokemonPresentations,
});

export const pokemonRowPresentation = defineEntityPresentation({
	component: PokemonRow,
	loader: loadPokemonPresentations,
	prepare: preparePokemonPresentations,
});
