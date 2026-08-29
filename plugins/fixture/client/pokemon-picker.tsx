import type { usePluginLocation } from "@ryot-app/client-sdk/plugin";
import { usePluginSearch } from "@ryot-app/client-sdk/plugin";
import {
	createRyotMutation,
	createRyotQuery,
	usePluginNavigation,
	useRyot,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/client-sdk/react";
import { Button, Modal, RadioGroup, StatusMessage, useValueChange } from "@ryot-app/client-ui-sdk";
import { useEffect, useEffectEvent, useState } from "react";

import { fixtureCollectionChoicesRecipe, fixturePokemonChoicesRecipe } from "./query-recipes";

const DIALOG = "add-to-collection";

const collectionChoicesQuery = createRyotQuery(({ client, signal }) =>
	client.data.query(fixtureCollectionChoicesRecipe(), { signal }),
);

const pokemonChoicesQuery = createRyotQuery(({ client, signal }) =>
	client.data.query(fixturePokemonChoicesRecipe(), { signal }),
);

const addToCollectionMutation = createRyotMutation<
	{ readonly collectionId: string; readonly entityId: string },
	unknown
>(({ input, client }) => client.collections.upsertMembership(input));

const samePage = (
	left: ReturnType<typeof usePluginLocation>,
	right: ReturnType<typeof usePluginLocation>,
) => {
	if (left.kind !== right.kind) {
		return false;
	}
	if (left.kind === "route" && right.kind === "route") {
		return left.path === right.path;
	}
	return left.kind === "entity" && right.kind === "entity" && left.entityId === right.entityId;
};

export const PokemonPicker = () => {
	const ryot = useRyot();
	const search = usePluginSearch();
	const navigation = usePluginNavigation();
	const choices = useRyotQuery(collectionChoicesQuery);
	const pokemon = useRyotQuery(pokemonChoicesQuery);
	const mutation = useRyotMutation(addToCollectionMutation);
	const resetMutation = useEffectEvent(mutation.reset);
	const [reviewing, setReviewing] = useState(false);
	const [collectionId, setCollectionId] = useState<string>();
	const entityId = search.get("entityId");
	const selectedPokemon = pokemon.data?.find((choice) => choice.id === entityId);
	const open = search.get("dialog") === DIALOG && entityId !== null;
	const collection = choices.data?.find((choice) => choice.id === collectionId);

	useValueChange(open, (isOpen) => {
		if (!isOpen) {
			setReviewing(false);
			setCollectionId(undefined);
		}
	});
	useEffect(() => {
		if (!open) {
			resetMutation();
		}
	}, [open]);

	const locallyPushed = () => {
		const screens = navigation.getSnapshot().screens;
		const current = screens.at(-1);
		const previous = screens.at(-2);
		if (!current || !previous || !samePage(previous.location, current.location)) {
			return false;
		}
		const previousSearch = new URLSearchParams(previous.location.search);
		return previousSearch.get("dialog") !== DIALOG || previousSearch.get("entityId") !== entityId;
	};

	const close = () => {
		if (locallyPushed()) {
			navigation.back();
			return;
		}
		ryot.navigation.pageSearch.replace({ dialog: null, entityId: null });
	};

	const confirm = () => {
		if (collectionId === undefined || entityId === null) {
			return;
		}
		mutation
			.mutateAsync({ entityId, collectionId })
			.then(close)
			.catch(() => undefined);
	};

	return (
		<>
			<section className="flex flex-col gap-2" aria-labelledby="pokemon-picker-heading">
				<h2 id="pokemon-picker-heading" className="font-display text-lg text-text">
					Pokemon picker
				</h2>
				{pokemon.status === "pending" ? (
					<StatusMessage tone="pending">Loading Pokemon...</StatusMessage>
				) : null}
				{pokemon.status === "error" ? (
					<StatusMessage tone="error">Pokemon are unavailable.</StatusMessage>
				) : null}
				<div className="flex flex-wrap gap-2">
					{pokemon.data?.map((choice) => (
						<Button
							type="button"
							key={choice.id}
							variant="secondary"
							onClick={() =>
								ryot.navigation.pageSearch.push({ dialog: DIALOG, entityId: choice.id })
							}
						>
							Add {choice.name} to collection
						</Button>
					))}
				</div>
			</section>
			{open ? (
				<Modal
					onClose={close}
					backEnabled={false}
					labelledBy="pokemon-picker-title"
					closeLabel="Cancel adding Pokemon"
					className="m-auto flex max-h-[calc(100%-2rem)] w-[min(32rem,calc(100%-2rem))] flex-col overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-xl"
				>
					<h2 id="pokemon-picker-title" className="font-display text-xl text-text">
						{reviewing ? "Review collection change" : "Choose a collection"}
					</h2>
					<p className="mt-1 text-sm text-text-muted">
						Pokemon: {selectedPokemon?.name ?? "Loading..."}
					</p>
					{reviewing && collection && selectedPokemon ? (
						<div className="mt-5 flex flex-col gap-4 text-text">
							<p>
								Add <strong>{selectedPokemon.name}</strong> to <strong>{collection.name}</strong>?
							</p>
							{mutation.status === "error" ? (
								<StatusMessage tone="error">
									The collection could not be updated. Your selection is preserved.
								</StatusMessage>
							) : null}
							{mutation.isPending ? (
								<StatusMessage tone="pending">Adding Pokemon...</StatusMessage>
							) : null}
							<div className="flex flex-wrap justify-end gap-2">
								<Button
									type="button"
									variant="text"
									disabled={mutation.isPending}
									onClick={() => setReviewing(false)}
								>
									Back to collections
								</Button>
								<Button
									type="button"
									onClick={close}
									variant="secondary"
									disabled={mutation.isPending}
								>
									Cancel
								</Button>
								<Button type="button" onClick={confirm} disabled={mutation.isPending}>
									{mutation.status === "error" ? "Try again" : "Confirm"}
								</Button>
							</div>
						</div>
					) : (
						<div className="mt-5 flex flex-col gap-4">
							{choices.status === "pending" ? (
								<StatusMessage tone="pending">Loading collections...</StatusMessage>
							) : null}
							{choices.status === "error" ? (
								<>
									<StatusMessage tone="error">Collections are unavailable.</StatusMessage>
									<Button type="button" variant="secondary" onClick={choices.refetch}>
										Try again
									</Button>
								</>
							) : null}
							{choices.status === "success" && choices.data?.length === 0 ? (
								<StatusMessage tone="pending">No collections are available.</StatusMessage>
							) : null}
							{choices.data && choices.data.length > 0 ? (
								<RadioGroup
									label="Collection"
									value={collectionId}
									onChange={setCollectionId}
									className="flex flex-col gap-2"
									options={choices.data.map((choice) => ({
										id: choice.id,
										value: choice.id,
										name: choice.name,
										label: choice.name,
									}))}
									renderOption={(choice, selected) => ({
										content: choice.label,
										className: `min-h-11 rounded-lg border px-3 py-2 text-left ${selected ? "border-accent bg-accent-soft text-text" : "border-border text-text"}`,
									})}
								/>
							) : null}
							<div className="flex justify-end gap-2">
								<Button type="button" onClick={close} variant="secondary">
									Cancel
								</Button>
								<Button
									type="button"
									onClick={() => setReviewing(true)}
									disabled={collectionId === undefined}
								>
									Review
								</Button>
							</div>
						</div>
					)}
				</Modal>
			) : null}
		</>
	);
};

export default PokemonPicker;
