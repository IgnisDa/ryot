import type { EntityId } from "@ryot-app/contract/schema/brands";
import { formatDisplayText } from "@ryot-app/i18n/format";
import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
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
	const t = useT();
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
			closeLabel={t(kernelMessage("client.collections.picker.close"))}
			footer={<Button onClick={close}>{t(kernelMessage("common.action.done"))}</Button>}
			title={t(
				target.data
					? kernelMessage("client.collections.picker.title-for", { name: target.data.name })
					: kernelMessage("client.collections.picker.title"),
			)}
		/>
	);
}

function SelectedCollection(props: {
	readonly onClose: () => void;
	readonly onSaved: () => void;
	readonly onRemoved: () => void;
	readonly target: MembershipTarget;
}) {
	const t = useT();
	const [membershipDetails] = useState(createMembershipDetailsQuery);
	const result = useRyotQuery(membershipDetails, props.target, { refreshOnMutation: false });
	const header = result.data?.header;
	if (result.data && header) {
		return <MembershipForm {...props} header={header} membership={result.data.membership} />;
	}
	return (
		<CollectionLoadDialog
			onClose={props.onClose}
			failed={result.isError}
			onRetry={result.refetch}
			missing={result.data !== undefined}
			title={t(kernelMessage("client.collections.load.title"))}
			closeLabel={t(kernelMessage("client.collections.close-membership"))}
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
	const t = useT();
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
					{t(
						editing
							? kernelMessage("client.collections.membership.save-failed")
							: kernelMessage("client.collections.membership.add-failed"),
					)}
				</Notice>
			) : null}
			{confirmingRemove ? (
				<DestructiveConfirmation
					triggerRef={removeTrigger}
					pending={remove.isPending}
					onClose={() => setConfirmingRemove(false)}
					onConfirm={() => remove.mutate(props.target)}
					pendingLabel={t(kernelMessage("client.collections.removing"))}
					detail={t(kernelMessage("client.collections.membership.remove-detail"))}
					actionLabel={t(kernelMessage("client.collections.remove-from-collection"))}
					title={t(
						kernelMessage("client.collections.membership.remove-title", { name: header.name }),
					)}
					errorMessage={
						remove.error
							? t(kernelMessage("client.collections.membership.remove-failed"))
							: undefined
					}
				/>
			) : null}
		</>
	);
	let title: Text = t(
		kernelMessage("client.collections.membership.add-title", { name: header.name }),
	);
	if (editing) {
		title = hasFields
			? t(kernelMessage("client.collections.membership.details-title", { name: header.name }))
			: formatDisplayText(t, header.name);
	}
	return (
		<Dialog
			title={title}
			dismissible={!busy}
			onClose={props.onClose}
			closeLabel={t(kernelMessage("client.collections.close-membership"))}
			description={
				editing && !hasFields
					? t(kernelMessage("client.collections.membership.in-collection"))
					: undefined
			}
			footer={
				<>
					<Button
						variant="ghost"
						disabled={busy}
						className="mr-auto"
						onClick={props.onClose}
						aria-label={t(kernelMessage("client.collections.back-to-collections"))}
					>
						<AppIcon size={16} name="chevron-left" />
						{t(kernelMessage("common.action.back"))}
					</Button>
					{editing ? (
						<Button
							disabled={busy}
							ref={removeTrigger}
							variant="dangerGhost"
							onClick={() => setConfirmingRemove(true)}
							aria-label={t(kernelMessage("client.collections.remove-from-collection"))}
						>
							{t(kernelMessage("common.action.remove"))}
						</Button>
					) : null}
					{editing && !hasFields ? null : (
						<Button
							disabled={busy}
							loading={save.isPending}
							onClick={() => void form.handleSubmit()}
						>
							{t(
								editing
									? kernelMessage("client.collections.membership.save-details")
									: kernelMessage("sdk.selection.add-to-collection"),
							)}
						</Button>
					)}
				</>
			}
		>
			{hasFields || save.error || confirmingRemove ? body : undefined}
		</Dialog>
	);
}
