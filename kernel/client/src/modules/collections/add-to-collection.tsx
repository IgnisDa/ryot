import type { EntityId } from "@ryot-app/contract/schema/brands";
import type { AddToCollectionOutcome } from "@ryot-app/plugin-client-contract";
import type { RyotClient } from "@ryot-app/plugin-client-sdk";
import {
	createRyotMutation,
	createRyotQuery,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, DestructiveConfirmation, Dialog, Notice } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import {
	collectionHeaderRecipe,
	type CollectionHeaderResult,
	collectionMembershipRecipe,
	type CollectionMembershipResult,
	collectionMembershipTargetRecipe,
} from "@ryot-app/ryotql-recipes/collections";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";

import { CollectionLoadDialog } from "#/modules/collections/collection-load-dialog";
import { CollectionPicker } from "#/modules/collections/collection-picker";
import {
	hasMembershipFields,
	MembershipFields,
	membershipSchema,
	useMembershipForm,
} from "#/modules/collections/membership-fields";

type MembershipTarget = { readonly entityId: EntityId; readonly collectionId: EntityId };

const membershipTarget = createRyotQuery(
	({
		input,
		client,
	}: {
		readonly client: RyotClient;
		readonly input: { readonly entityId: EntityId };
	}) => client.data.query(collectionMembershipTargetRecipe, { entityId: input.entityId }),
);

const createMembershipDetailsQuery = () =>
	createRyotQuery(
		({ input, client }: { readonly client: RyotClient; readonly input: MembershipTarget }) =>
			Effect.all(
				{
					header: client.data.query(collectionHeaderRecipe, { collectionId: input.collectionId }),
					membership: client.data.query(collectionMembershipRecipe, {
						entityId: input.entityId,
						collectionId: input.collectionId,
					}),
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
		readonly client: RyotClient;
		readonly input: Parameters<RyotClient["collections"]["upsertMembership"]>[0];
	}) => client.collections.upsertMembership(input),
);

const removeMembership = createRyotMutation(
	({ input, client }: { readonly client: RyotClient; readonly input: MembershipTarget }) =>
		client.collections.removeMembership(input),
);

export function AddToCollection(props: {
	readonly entityId: EntityId;
	readonly onClose: () => void;
	readonly onSaved: () => void;
	readonly onRemoved: () => void;
	readonly collectionId?: EntityId | undefined;
}) {
	const target = useRyotQuery(membershipTarget, { entityId: props.entityId });
	const outcome = useRef<AddToCollectionOutcome["kind"]>("cancelled");
	const [collectionId, setCollectionId] = useState(props.collectionId);
	const returnToCollections = () => setCollectionId(undefined);
	const close = () => {
		if (outcome.current === "saved") {
			props.onSaved();
		} else if (outcome.current === "removed") {
			props.onRemoved();
		} else {
			props.onClose();
		}
	};
	if (collectionId !== undefined) {
		return (
			<SelectedCollection
				onClose={returnToCollections}
				target={{ collectionId, entityId: props.entityId }}
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
	return (
		<CollectionPicker
			onClose={close}
			entityId={props.entityId}
			onChosen={setCollectionId}
			closeLabel="Close collections"
			footer={<Button onClick={close}>Done</Button>}
			title={target.data ? `Collections for ${target.data.name}` : "Collections"}
		/>
	);
}

function SelectedCollection(props: {
	readonly onClose: () => void;
	readonly onSaved: () => void;
	readonly onRemoved: () => void;
	readonly target: MembershipTarget;
}) {
	const [membershipDetails] = useState(createMembershipDetailsQuery);
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

function MembershipForm(props: {
	readonly onClose: () => void;
	readonly onSaved: () => void;
	readonly onRemoved: () => void;
	readonly target: MembershipTarget;
	readonly membership: CollectionMembershipResult;
	readonly header: NonNullable<CollectionHeaderResult>;
}) {
	const { header, membership } = props;
	const removeTrigger = useRef<HTMLButtonElement>(null);
	const [confirmingRemove, setConfirmingRemove] = useState(false);
	const schema = membershipSchema(header);
	const save = useRyotMutation(upsertMembership);
	const remove = useRyotMutation(removeMembership);
	const form = useMembershipForm({
		schema,
		properties: membership?.properties,
		seedKey: `${props.target.collectionId}:${membership === null}`,
		onSubmit: (properties) =>
			save.mutate({
				...props.target,
				properties,
				...(membership === null ? { mode: "add-if-absent" as const } : {}),
			}),
	});
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
	const hasFields = hasMembershipFields(schema);
	const body = (
		<>
			{hasFields ? <MembershipFields form={form} schema={schema} disabled={busy} /> : null}
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
		</>
	);
	let title = `Add to ${header.name}`;
	if (editing) {
		title = hasFields ? `Details in ${header.name}` : header.name;
	}
	return (
		<Dialog
			title={title}
			dismissible={!busy}
			onClose={props.onClose}
			closeLabel="Close collection membership"
			description={editing && !hasFields ? "This item is in this collection." : undefined}
			footer={
				<>
					<Button
						variant="ghost"
						disabled={busy}
						className="mr-auto"
						onClick={props.onClose}
						aria-label="Back to collections"
					>
						<AppIcon size={16} name="chevron-left" />
						Back
					</Button>
					{editing ? (
						<Button
							disabled={busy}
							ref={removeTrigger}
							variant="dangerGhost"
							aria-label="Remove from collection"
							onClick={() => setConfirmingRemove(true)}
						>
							Remove
						</Button>
					) : null}
					{editing && !hasFields ? null : (
						<Button
							disabled={busy}
							loading={save.isPending}
							onClick={() => void form.handleSubmit()}
						>
							{editing ? "Save details" : "Add to collection"}
						</Button>
					)}
				</>
			}
		>
			{hasFields || save.error || confirmingRemove ? body : undefined}
		</Dialog>
	);
}
