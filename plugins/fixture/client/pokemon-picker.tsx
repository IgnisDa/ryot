import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import type { usePluginLocation } from "@ryot-app/plugin-client-sdk/plugin";
import { usePluginSearch } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotMutation,
	createRyotQuery,
	useDisplayText,
	useMessages,
	usePluginNavigation,
	useRyot,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, Modal, RadioGroup, StatusMessage, useValueChange } from "@ryot-app/plugin-ui-sdk";
import { useEffect, useEffectEvent, useState } from "react";

import { catalogMessage } from "../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import { fixtureCollectionChoicesRecipe, fixturePokemonChoicesRecipe } from "./query-recipes";

const DIALOG = "add-to-collection";

const collectionChoicesQuery = createRyotQuery(({ client }) =>
	client.data.query(fixtureCollectionChoicesRecipe, {}),
);

const pokemonChoicesQuery = createRyotQuery(({ client }) =>
	client.data.query(fixturePokemonChoicesRecipe(client.pluginIdentity(PLUGIN_PACKAGE_ID)), {}),
);

const addToCollectionMutation = createRyotMutation<
	{ readonly entityId: string; readonly collectionId: string; readonly onSuccess: () => void },
	void
>(({ input, client }) =>
	Effect.gen(function* () {
		yield* client.collections.upsertMembership(input);
		input.onSuccess();
	}),
);

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
	const text = useMessages(PLUGIN_PACKAGE_ID, catalogMessage);
	const displayText = useDisplayText();
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
		mutation.mutate({ entityId, collectionId, onSuccess: close });
	};

	return (
		<>
			<section className="flex flex-col gap-2" aria-labelledby="pokemon-picker-heading">
				<h2 id="pokemon-picker-heading" className="font-display text-lg text-text">
					{text("pokemon-picker.title")}
				</h2>
				{pokemon.status === "pending" ? (
					<StatusMessage tone="pending">{text("pokemon.status.loading")}</StatusMessage>
				) : null}
				{pokemon.status === "error" ? (
					<StatusMessage tone="error">{text("pokemon-picker.pokemon-unavailable")}</StatusMessage>
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
							{text("pokemon-picker.add-to-collection", { name: choice.name })}
						</Button>
					))}
				</div>
			</section>
			{open ? (
				<Modal
					onClose={close}
					backEnabled={false}
					labelledBy="pokemon-picker-title"
					className="m-auto flex max-h-[calc(100%-2rem)] w-[min(32rem,calc(100%-2rem))] flex-col overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-xl"
				>
					<h2 id="pokemon-picker-title" className="font-display text-xl text-text">
						{reviewing ? text("pokemon-picker.review-title") : text("pokemon-picker.choose-title")}
					</h2>
					<p className="mt-1 text-sm text-text-muted">
						{text("pokemon-picker.selected-pokemon", {
							name: selectedPokemon?.name ?? text("common.status.loading"),
						})}
					</p>
					{reviewing && collection && selectedPokemon ? (
						<div className="mt-5 flex flex-col gap-4 text-text">
							<p>
								{text("pokemon-picker.confirm-add", {
									collection: collection.name,
									pokemon: selectedPokemon.name,
								})}
							</p>
							{mutation.status === "error" ? (
								<StatusMessage tone="error">{text("pokemon-picker.update-failed")}</StatusMessage>
							) : null}
							{mutation.isPending ? (
								<StatusMessage tone="pending">{text("pokemon-picker.adding")}</StatusMessage>
							) : null}
							<div className="flex flex-wrap justify-end gap-2">
								<Button
									type="button"
									variant="ghost"
									disabled={mutation.isPending}
									onClick={() => setReviewing(false)}
								>
									{text("pokemon-picker.back-to-collections")}
								</Button>
								<Button
									type="button"
									onClick={close}
									variant="secondary"
									disabled={mutation.isPending}
								>
									{text("common.action.cancel")}
								</Button>
								<Button type="button" onClick={confirm} disabled={mutation.isPending}>
									{mutation.status === "error"
										? text("common.action.try-again")
										: text("common.action.confirm")}
								</Button>
							</div>
						</div>
					) : (
						<div className="mt-5 flex flex-col gap-4">
							{choices.status === "pending" ? (
								<StatusMessage tone="pending">
									{text("pokemon-picker.collections-loading")}
								</StatusMessage>
							) : null}
							{choices.status === "error" ? (
								<>
									<StatusMessage tone="error">
										{text("pokemon-picker.collections-unavailable")}
									</StatusMessage>
									<Button type="button" variant="secondary" onClick={choices.refetch}>
										{text("common.action.try-again")}
									</Button>
								</>
							) : null}
							{choices.status === "success" && choices.data?.length === 0 ? (
								<StatusMessage tone="pending">
									{text("pokemon-picker.collections-empty")}
								</StatusMessage>
							) : null}
							{choices.data && choices.data.length > 0 ? (
								<RadioGroup
									value={collectionId}
									onChange={setCollectionId}
									className="flex flex-col gap-2"
									label={text("pokemon-picker.collection-label")}
									options={choices.data.map((choice) => ({
										id: choice.id,
										value: choice.id,
										name: choice.name,
										label: displayText(choice.name),
									}))}
									renderOption={(choice, selected) => ({
										content: choice.label,
										className: `min-h-11 rounded-lg border px-3 py-2 text-left ${selected ? "border-accent bg-accent-soft text-text" : "border-border text-text"}`,
									})}
								/>
							) : null}
							<div className="flex justify-end gap-2">
								<Button type="button" onClick={close} variant="secondary">
									{text("common.action.cancel")}
								</Button>
								<Button
									type="button"
									onClick={() => setReviewing(true)}
									disabled={collectionId === undefined}
								>
									{text("common.action.review")}
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
