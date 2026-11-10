import type { EntityId } from "@ryot-app/contract/schema/brands";
import type { RyotClient } from "@ryot-app/plugin-client-sdk";
import {
	createRyotQuery,
	nextPageCursor,
	PaginationError,
	paginationItems,
	useRyotInfiniteQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Badge,
	Button,
	Dialog,
	Field,
	LoadMoreButton,
	Notice,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import {
	collectionPickerRecipe,
	type CollectionPickerResult,
} from "@ryot-app/ryotql-recipes/collections";
import { type ReactNode, useState } from "react";

import { CollectionEditor } from "#/modules/collections/collection-editor";

type CollectionOption = CollectionPickerResult["items"][number];

const collectionOptions = createRyotQuery(
	({
		input,
		client,
	}: {
		readonly client: RyotClient;
		readonly input: Parameters<typeof collectionPickerRecipe>[0];
	}) => client.data.query(collectionPickerRecipe(input)),
);

export function CollectionPicker(props: {
	readonly title: string;
	readonly footer: ReactNode;
	readonly closeLabel: string;
	readonly onClose: () => void;
	readonly entityId?: EntityId | undefined;
	readonly onChosen: (collectionId: EntityId) => void;
}) {
	const [search, setSearch] = useState("");
	const [creating, setCreating] = useState<null | string>(null);
	if (creating !== null) {
		return (
			<CollectionEditor
				initialName={creating}
				onSaved={props.onChosen}
				onClose={() => setCreating(null)}
				onDeleted={() => setCreating(null)}
			/>
		);
	}
	const query = search.trim();
	return (
		<Dialog
			title={props.title}
			footer={props.footer}
			onClose={props.onClose}
			closeLabel={props.closeLabel}
		>
			<div className="grid gap-3">
				<Field label="Search collections">
					{(control) => (
						<TextField
							{...control}
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
					)}
				</Field>
				<Button variant="secondary" onClick={() => setCreating(query)}>
					{query === "" ? "New collection" : `Create “${query}” and add`}
				</Button>
				<CollectionOptions
					key={search}
					search={search}
					entityId={props.entityId}
					onSelect={(option) => props.onChosen(option.id)}
				/>
			</div>
		</Dialog>
	);
}

function CollectionOptions(props: {
	readonly search: string;
	readonly entityId: EntityId | undefined;
	readonly onSelect: (option: CollectionOption) => void;
}) {
	const result = useRyotInfiniteQuery(
		collectionOptions,
		{ search: props.search, ...(props.entityId === undefined ? {} : { entityId: props.entityId }) },
		{
			initialPageParam: undefined,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, after: string | undefined) => ({
				...input,
				...(after === undefined ? {} : { after }),
			}),
		},
	);
	const items = paginationItems(
		result.pages,
		({ items: pageItems }) => pageItems,
		({ id }) => id,
	);
	const errorNotice =
		result.error instanceof PaginationError ? (
			<Notice tone="danger">More collections could not be loaded. Close and reopen this.</Notice>
		) : (
			<Notice
				tone="danger"
				action={
					<Button variant="secondary" onClick={result.retry}>
						Retry collections
					</Button>
				}
			>
				Collections could not be loaded.
			</Notice>
		);
	if (result.pages.length === 0) {
		return result.isError ? errorNotice : <p role="status">Loading collections…</p>;
	}
	if (items.length === 0 && result.pageParams[0] === undefined) {
		return (
			<p role="status">
				{props.search.trim() === "" ? "You have no collections yet." : "No matching collections."}
			</p>
		);
	}
	return (
		<>
			<ul className="grid gap-2">
				{items.map((option) => (
					<li key={option.id}>
						<Button className="w-full" variant="secondary" onClick={() => props.onSelect(option)}>
							<span className="min-w-0 flex-1 text-left wrap-break-word">{option.name}</span>
							<span className="flex shrink-0 items-center gap-2">
								{option.added ? (
									<Badge size="sm" variant="success">
										<AppIcon size={12} name="check" />
										Added
									</Badge>
								) : null}
								<AppIcon size={15} name="chevron-right" className="text-text-subtle" />
							</span>
						</Button>
					</li>
				))}
			</ul>
			{result.isError ? errorNotice : null}
			{result.hasNextPage && !result.isError ? (
				<LoadMoreButton
					variant="secondary"
					label="Show more collections"
					onClick={result.fetchNextPage}
					disabled={result.isFetchingNextPage}
					isFetchingNextPage={result.isFetchingNextPage}
				/>
			) : null}
		</>
	);
}
