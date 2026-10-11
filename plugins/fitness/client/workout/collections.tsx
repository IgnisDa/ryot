import type { RyotClient } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	createRyotMutation,
	createRyotQuery,
	useRyot,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, Dialog, Field, Notice, TextField } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import {
	SchemaForm,
	initialSchemaFormValues,
	toSchemaFormPayload,
	useSchemaForm,
} from "@ryot-app/plugin-ui-sdk/schema-form";
import {
	collectionHeaderRecipe,
	collectionPickerRecipe,
	type CollectionHeaderResult,
	type CollectionPickerResult,
} from "@ryot-app/ryotql-recipes/collections";
import { useEffect, useState } from "react";

const collectionOptions = createRyotQuery(
	({
		input,
		client,
	}: {
		readonly input: Parameters<typeof collectionPickerRecipe>[0];
		readonly client: RyotClient;
	}) => client.data.query(collectionPickerRecipe(input)),
);

const collectionHeader = createRyotQuery(
	({ input, client }: { readonly input: string; readonly client: RyotClient }) =>
		client.data.query(collectionHeaderRecipe({ collectionId: input })),
);

const addMembership = createRyotMutation(
	({
		input,
		client,
	}: {
		readonly input: Parameters<RyotClient["collections"]["upsertMembership"]>[0];
		readonly client: RyotClient;
	}) => client.collections.upsertMembership(input),
);

type CollectionOption = CollectionPickerResult["items"][number];

const emptyMembershipSchema = { fields: {} };

function CollectionOptions(props: {
	readonly entityId: string;
	readonly search: string;
	readonly after?: string;
	readonly onSelect: (option: CollectionOption) => void;
}) {
	const [showMore, setShowMore] = useState(false);
	const result = useRyotQuery(collectionOptions, {
		search: props.search,
		entityId: props.entityId,
		...(props.after === undefined ? {} : { after: props.after }),
	});
	if (result.isError) {
		return (
			<Notice
				tone="danger"
				action={
					<Button variant="secondary" onClick={result.refetch}>
						Retry collections
					</Button>
				}
			>
				Collections could not be loaded.
			</Notice>
		);
	}
	if (!result.data) {
		return <p role="status">Loading collections…</p>;
	}
	const { items, pageInfo } = result.data;
	if (items.length === 0 && props.after === undefined) {
		return (
			<p role="status">
				{props.search.trim() === "" ? "You have no collections yet." : "No matching collections."}
			</p>
		);
	}
	const nextCursor = pageInfo.nextCursor;
	const hasNextPage = pageInfo.hasMore && nextCursor !== null && nextCursor !== props.after;
	return (
		<>
			<ul className="grid gap-2">
				{items.map((option) => (
					<li key={option.id}>
						<Button
							variant="secondary"
							disabled={option.added}
							className="w-full justify-between"
							onClick={() => props.onSelect(option)}
						>
							<span>{option.name}</span>
							{option.added ? <span>Already added</span> : null}
						</Button>
					</li>
				))}
			</ul>
			{hasNextPage && showMore ? <CollectionOptions {...props} after={nextCursor} /> : null}
			{hasNextPage && !showMore ? (
				<Button variant="secondary" onClick={() => setShowMore(true)}>
					Show more collections
				</Button>
			) : null}
			{pageInfo.hasMore && (nextCursor === null || nextCursor === props.after) ? (
				<Notice tone="danger">
					More collections could not be loaded. Close and reopen the picker.
				</Notice>
			) : null}
		</>
	);
}

function MembershipForm(props: {
	readonly collection: NonNullable<CollectionHeaderResult>;
	readonly entityId: string;
	readonly onClose: () => void;
}) {
	const { onClose, collection } = props;
	const client = useRyot();
	const schema = collection.membershipPropertiesSchema ?? emptyMembershipSchema;
	const [pendingInput, setPendingInput] =
		useState<Parameters<RyotClient["collections"]["upsertMembership"]>[0]>();
	const save = useRyotMutation(addMembership);
	const form = useSchemaForm({
		schemas: [schema],
		onSubmit: (values) => {
			const input = {
				entityId: props.entityId,
				mode: "add-if-absent" as const,
				collectionId: collection.entityId,
				properties: toSchemaFormPayload(schema, values),
			};
			setPendingInput(input);
			save.mutate(input);
		},
	});
	useEffect(() => form.reset(initialSchemaFormValues(schema)), [form, schema]);
	useEffect(() => {
		if (save.data) {
			onClose();
		}
	}, [onClose, save.data]);
	return (
		<Dialog
			onClose={props.onClose}
			dismissible={!save.isPending}
			title={`Add to ${collection.name}`}
			closeLabel="Cancel adding to collection"
			footer={
				<>
					<Button variant="secondary" onClick={props.onClose} disabled={save.isPending}>
						Cancel
					</Button>
					<Button
						loading={save.isPending}
						onClick={() => {
							if (pendingInput) {
								save.mutate(pendingInput);
							} else {
								void form.handleSubmit();
							}
						}}
					>
						{save.error ? "Retry adding" : "Add to collection"}
					</Button>
				</>
			}
		>
			<fieldset
				className="min-w-0 border-0 p-0"
				disabled={save.isPending || pendingInput !== undefined}
			>
				<SchemaForm
					form={form}
					schema={schema}
					onChange={() => {}}
					icons={{
						close: <AppIcon name="x" size={16} />,
						remove: <AppIcon name="x" size={16} />,
						file: <AppIcon size={16} name="file" />,
						check: <AppIcon size={16} name="check" />,
						search: <AppIcon size={16} name="search" />,
						upload: <AppIcon size={16} name="upload" />,
						chevron: <AppIcon size={16} name="chevron-down" />,
					}}
					uploadFile={(request) =>
						Effect.runPromise(
							client.uploads.uploadTemporary(request).pipe(
								Effect.map((uploaded) => ({ kind: "uploaded", token: uploaded.token }) as const),
								Effect.orElseSucceed(
									() =>
										({
											kind: "failed",
											message: "Could not upload this file. Try again.",
										}) as const,
								),
							),
						)
					}
				/>
			</fieldset>
			{save.error ? (
				<Notice tone="danger">
					The workout could not be added. Retry the same selection, or cancel and reopen the picker
					to choose again.
				</Notice>
			) : null}
		</Dialog>
	);
}

function SelectedCollection(props: {
	readonly entityId: string;
	readonly collectionId: string;
	readonly onClose: () => void;
}) {
	const result = useRyotQuery(collectionHeader, props.collectionId, { refreshOnMutation: false });
	if (result.data) {
		return (
			<MembershipForm onClose={props.onClose} collection={result.data} entityId={props.entityId} />
		);
	}
	return (
		<Dialog
			onClose={props.onClose}
			title="Add to collection"
			closeLabel="Close collections"
			closeIcon={<AppIcon name="x" size={18} />}
		>
			{result.isError ? (
				<Notice
					tone="danger"
					action={
						<Button variant="secondary" onClick={result.refetch}>
							Retry collection
						</Button>
					}
				>
					The collection could not be loaded.
				</Notice>
			) : (
				<p role="status">
					{result.data === null
						? "This collection no longer exists. Close and reopen the picker."
						: "Loading collection…"}
				</p>
			)}
		</Dialog>
	);
}

export function AddWorkoutToCollection(props: {
	readonly entityId: string;
	readonly onClose: () => void;
}) {
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState<CollectionOption>();
	if (selected) {
		return (
			<SelectedCollection
				onClose={props.onClose}
				entityId={props.entityId}
				collectionId={selected.id}
			/>
		);
	}
	return (
		<Dialog
			onClose={props.onClose}
			title="Add to collection"
			closeLabel="Close collections"
			closeIcon={<AppIcon name="x" size={18} />}
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
				<CollectionOptions
					key={search}
					search={search}
					onSelect={setSelected}
					entityId={props.entityId}
				/>
			</div>
		</Dialog>
	);
}
