import type { EntityId } from "@ryot-app/contract/schema/brands";
import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
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
import type { Recipe } from "@ryot-app/ryotql";
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
		readonly input: Recipe.Arguments<typeof collectionPickerRecipe> & {
			readonly after?: string;
			readonly limit?: number;
		};
	}) =>
		client.data.query(
			collectionPickerRecipe,
			{
				search: input.search,
				...(input.entityId === undefined ? {} : { entityId: input.entityId }),
			},
			{ pages: { collections: { after: input.after } } },
		),
);

export function CollectionPicker(props: {
	readonly title: Text;
	readonly closeLabel: Text;
	readonly footer: ReactNode;
	readonly onClose: () => void;
	readonly entityId?: EntityId | undefined;
	readonly onChosen: (collectionId: EntityId) => void;
}) {
	const t = useT();
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
				<Field label={t(kernelMessage("client.collections.picker.search"))}>
					{(control) => (
						<TextField
							{...control}
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
					)}
				</Field>
				<Button variant="secondary" onClick={() => setCreating(query)}>
					{t(
						query === ""
							? kernelMessage("renderer.collections.new")
							: kernelMessage("client.collections.picker.create-and-add", { name: query }),
					)}
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
	const t = useT();
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
			<Notice tone="danger">{t(kernelMessage("client.collections.picker.more-failed"))}</Notice>
		) : (
			<Notice
				tone="danger"
				action={
					<Button variant="secondary" onClick={result.retry}>
						{t(kernelMessage("common.action.retry"))}
					</Button>
				}
			>
				{t(kernelMessage("client.collections.picker.load-failed"))}
			</Notice>
		);
	if (result.pages.length === 0) {
		return result.isError ? (
			errorNotice
		) : (
			<p role="status">{t(kernelMessage("client.collections.picker.loading"))}</p>
		);
	}
	if (items.length === 0 && result.pageParams[0] === undefined) {
		return (
			<p role="status">
				{t(
					props.search.trim() === ""
						? kernelMessage("client.collections.picker.empty")
						: kernelMessage("client.collections.picker.no-match"),
				)}
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
										{t(kernelMessage("client.collections.picker.added"))}
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
					onClick={result.fetchNextPage}
					disabled={result.isFetchingNextPage}
					isFetchingNextPage={result.isFetchingNextPage}
					label={t(kernelMessage("client.collections.picker.show-more"))}
				/>
			) : null}
		</>
	);
}
