import type { EntityId } from "@ryot-app/contract/schema/brands";
import type { AddToCollectionOutcome } from "@ryot-app/plugin-client-contract";
import type { RyotClient } from "@ryot-app/plugin-client-sdk";
import {
	createRyotMutation,
	createRyotQuery,
	nextPageCursor,
	PaginationError,
	paginationItems,
	renderSchemaAsset,
	useRyotInfiniteQuery,
	useRyotMutation,
	useRyotQuery,
	useSchemaAssetUpload,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Badge,
	Button,
	DestructiveConfirmation,
	Dialog,
	Field,
	LoadMoreButton,
	Notice,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import {
	initialSchemaFormValues,
	SchemaForm,
	type SchemaFormValues,
	toSchemaFormPayload,
	useSchemaForm,
} from "@ryot-app/plugin-ui-sdk/schema-form";
import {
	collectionHeaderRecipe,
	type CollectionHeaderResult,
	collectionMembershipRecipe,
	type CollectionMembershipResult,
	collectionMembershipTargetRecipe,
	collectionPickerRecipe,
	type CollectionPickerResult,
} from "@ryot-app/ryotql-recipes/collections";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";

import { CollectionEditor } from "#/modules/collections/collection-editor";
import { CollectionLoadDialog } from "#/modules/collections/collection-load-dialog";
import { schemaFormReorderFeedback } from "#/modules/ui/schema-form-feedback";
import { schemaFormIcons } from "#/modules/ui/schema-form-icons";
import { useSchemaFileUpload } from "#/modules/ui/schema-form-upload";
import { useFormSeed } from "#/modules/ui/use-form-seed";

type CollectionOption = CollectionPickerResult["items"][number];

type MembershipTarget = { readonly entityId: EntityId; readonly collectionId: EntityId };

const membershipTarget = createRyotQuery(
	({
		input,
		client,
	}: {
		readonly input: { readonly entityId: EntityId };
		readonly client: RyotClient;
	}) => client.data.query(collectionMembershipTargetRecipe(input)),
);

const collectionOptions = createRyotQuery(
	({
		input,
		client,
	}: {
		readonly input: Parameters<typeof collectionPickerRecipe>[0];
		readonly client: RyotClient;
	}) => client.data.query(collectionPickerRecipe(input)),
);

const membershipDetails = createRyotQuery(
	({ input, client }: { readonly input: MembershipTarget; readonly client: RyotClient }) =>
		Effect.all(
			{
				membership: client.data.query(collectionMembershipRecipe(input)),
				header: client.data.query(collectionHeaderRecipe({ collectionId: input.collectionId })),
			},
			{ concurrency: "unbounded" },
		),
	{ cancelOnUnmount: true },
);

const upsertMembership = createRyotMutation(
	({
		input,
		client,
	}: {
		readonly input: Parameters<RyotClient["collections"]["upsertMembership"]>[0];
		readonly client: RyotClient;
	}) => client.collections.upsertMembership(input),
);

const removeMembership = createRyotMutation(
	({ input, client }: { readonly input: MembershipTarget; readonly client: RyotClient }) =>
		client.collections.removeMembership(input),
);

const emptyMembershipSchema = { fields: {} };

function CollectionOptions(props: {
	readonly entityId: EntityId;
	readonly search: string;
	readonly onSelect: (option: CollectionOption) => void;
}) {
	const result = useRyotInfiniteQuery(
		collectionOptions,
		{ search: props.search, entityId: props.entityId },
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
							<span className="min-w-0 flex-1 text-left break-words">{option.name}</span>
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

function MembershipForm(props: {
	readonly target: MembershipTarget;
	readonly header: NonNullable<CollectionHeaderResult>;
	readonly membership: CollectionMembershipResult;
	readonly onClose: () => void;
	readonly onSaved: () => void;
	readonly onRemoved: () => void;
}) {
	const { header, membership } = props;
	const uploadAsset = useSchemaAssetUpload();
	const uploadFile = useSchemaFileUpload();
	const removeTrigger = useRef<HTMLButtonElement>(null);
	const [confirmingRemove, setConfirmingRemove] = useState(false);
	const schema = header.membershipPropertiesSchema ?? emptyMembershipSchema;
	const save = useRyotMutation(upsertMembership);
	const remove = useRyotMutation(removeMembership);
	const form = useSchemaForm({
		schemas: [schema],
		onSubmit: (values: SchemaFormValues) =>
			save.mutate({
				...props.target,
				properties: toSchemaFormPayload(schema, values),
				...(membership === null ? { mode: "add-if-absent" as const } : {}),
			}),
	});
	useFormSeed(form, `${props.target.collectionId}:${membership === null}`, () =>
		initialSchemaFormValues(schema, undefined, membership?.properties),
	);
	const { onSaved, onRemoved } = props;
	useEffect(() => {
		if (save.data) {
			onSaved();
		}
	}, [onSaved, save.data]);
	useEffect(() => {
		if (remove.data) {
			onRemoved();
		}
	}, [onRemoved, remove.data]);
	const busy = save.isPending || remove.isPending;
	const editing = membership !== null;
	return (
		<Dialog
			dismissible={!busy}
			onClose={props.onClose}
			closeLabel="Close collection membership"
			title={editing ? `Details in ${header.name}` : `Add to ${header.name}`}
			footer={
				<>
					{editing ? (
						<Button
							variant="ghost"
							disabled={busy}
							ref={removeTrigger}
							className="mr-auto"
							onClick={() => setConfirmingRemove(true)}
						>
							Remove from collection
						</Button>
					) : null}
					<Button disabled={busy} variant="secondary" onClick={props.onClose}>
						Back to collections
					</Button>
					<Button disabled={busy} loading={save.isPending} onClick={() => void form.handleSubmit()}>
						{editing ? "Save details" : "Add to collection"}
					</Button>
				</>
			}
		>
			<fieldset disabled={busy} className="min-w-0 border-0 p-0">
				<SchemaForm
					form={form}
					schema={schema}
					uploadFile={uploadFile}
					icons={schemaFormIcons}
					uploadAsset={uploadAsset}
					onChange={() => undefined}
					renderAsset={renderSchemaAsset}
					onReorder={schemaFormReorderFeedback}
				/>
			</fieldset>
			{save.error ? (
				<Notice tone="danger">
					{editing ? "The details could not be saved." : "The item could not be added."} Try again.
				</Notice>
			) : null}
			{confirmingRemove ? (
				<DestructiveConfirmation
					triggerRef={removeTrigger}
					pending={remove.isPending}
					pendingLabel="Removing..."
					actionLabel="Remove from collection"
					title={`Remove from ${header.name}?`}
					onClose={() => setConfirmingRemove(false)}
					onConfirm={() => remove.mutate(props.target)}
					detail="The item stays in your library; only its membership and details are removed."
					errorMessage={remove.error ? "The item could not be removed. Try again." : undefined}
				/>
			) : null}
		</Dialog>
	);
}

function SelectedCollection(props: {
	readonly target: MembershipTarget;
	readonly onClose: () => void;
	readonly onSaved: () => void;
	readonly onRemoved: () => void;
}) {
	const result = useRyotQuery(membershipDetails, props.target, { refreshOnMutation: false });
	const header = result.data?.header;
	if (result.data && header) {
		return <MembershipForm {...props} header={header} membership={result.data.membership} />;
	}
	return (
		<CollectionLoadDialog
			title="Collection"
			onClose={props.onClose}
			failed={result.isError}
			onRetry={result.refetch}
			missing={result.data !== undefined}
			closeLabel="Close collection membership"
		/>
	);
}

type AddView =
	| { readonly kind: "pick" }
	| { readonly kind: "create"; readonly name: string }
	| { readonly kind: "membership"; readonly collectionId: EntityId };

export function AddToCollection(props: {
	readonly entityId: EntityId;
	readonly collectionId?: EntityId | undefined;
	readonly onClose: () => void;
	readonly onSaved: () => void;
	readonly onRemoved: () => void;
}) {
	const [search, setSearch] = useState("");
	const target = useRyotQuery(membershipTarget, { entityId: props.entityId });
	const outcome = useRef<AddToCollectionOutcome["kind"]>("cancelled");
	const [view, setView] = useState<AddView>(
		props.collectionId === undefined
			? { kind: "pick" }
			: { kind: "membership", collectionId: props.collectionId },
	);
	const returnToCollections = () => setView({ kind: "pick" });
	const close = () => {
		if (outcome.current === "saved") {
			props.onSaved();
		} else if (outcome.current === "removed") {
			props.onRemoved();
		} else {
			props.onClose();
		}
	};
	if (view.kind === "membership") {
		return (
			<SelectedCollection
				onClose={returnToCollections}
				target={{ entityId: props.entityId, collectionId: view.collectionId }}
				onSaved={() => {
					outcome.current = "saved";
					returnToCollections();
				}}
				onRemoved={() => {
					outcome.current = "removed";
					returnToCollections();
				}}
			/>
		);
	}
	if (view.kind === "create") {
		return (
			<CollectionEditor
				initialName={view.name}
				onClose={returnToCollections}
				onDeleted={returnToCollections}
				onSaved={(collectionId) => setView({ collectionId, kind: "membership" })}
			/>
		);
	}
	const query = search.trim();
	return (
		<Dialog
			onClose={close}
			closeLabel="Close collections"
			footer={<Button onClick={close}>Done</Button>}
			title={target.data ? `Collections for ${target.data.name}` : "Collections"}
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
				<Button variant="secondary" onClick={() => setView({ name: query, kind: "create" })}>
					{query === "" ? "New collection" : `Create “${query}” and add`}
				</Button>
				<CollectionOptions
					key={search}
					search={search}
					entityId={props.entityId}
					onSelect={(option) => setView({ kind: "membership", collectionId: option.id })}
				/>
			</div>
		</Dialog>
	);
}
