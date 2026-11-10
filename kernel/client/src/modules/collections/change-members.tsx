import type { EntityId } from "@ryot-app/contract/schema/brands";
import type {
	ChangeCollectionMembersOutcome,
	ChangeCollectionMembersRequest,
} from "@ryot-app/plugin-client-contract";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	DestructiveConfirmation,
	Dialog,
	Notice,
	ProgressBar,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { CollectionHeaderResult } from "@ryot-app/ryotql-recipes/collections";
import { useRef, useState } from "react";

import { collectionHeaderQuery } from "#/modules/collections/collection-header";
import { CollectionLoadDialog } from "#/modules/collections/collection-load-dialog";
import { CollectionPicker } from "#/modules/collections/collection-picker";
import {
	hasMembershipFields,
	MembershipFields,
	membershipSchema,
	useMembershipForm,
} from "#/modules/collections/membership-fields";
import {
	type MembershipChange,
	type MembershipRun,
	useMembershipRun,
} from "#/modules/collections/membership-run";

type Complete = (outcome: ChangeCollectionMembersOutcome) => void;

const itemCount = (count: number) => `${count.toLocaleString()} item${count === 1 ? "" : "s"}`;

const copy = {
	add: { done: "Added", active: "Adding", failed: "could not be added" },
	remove: { done: "Removed", active: "Removing", failed: "could not be removed" },
} as const;

export function ChangeCollectionMembers(props: {
	readonly complete: Complete;
	readonly request: ChangeCollectionMembersRequest;
}) {
	const { request } = props;
	const [collectionId, setCollectionId] = useState(
		request.kind === "remove" ? request.collectionId : undefined,
	);
	const cancel = () => props.complete({ kind: "cancelled" });
	if (collectionId === undefined) {
		return (
			<CollectionPicker
				onClose={cancel}
				onChosen={setCollectionId}
				closeLabel="Close collections"
				title={`Add ${itemCount(request.entityIds.length)} to a collection`}
				footer={
					<Button variant="ghost" onClick={cancel}>
						Cancel
					</Button>
				}
			/>
		);
	}
	return (
		<ChosenCollection
			kind={request.kind}
			complete={props.complete}
			collectionId={collectionId}
			entityIds={request.entityIds}
			onBack={request.kind === "add" ? () => setCollectionId(undefined) : undefined}
		/>
	);
}

function RemoveConfirmation(props: {
	readonly name: string;
	readonly count: number;
	readonly onClose: () => void;
	readonly onConfirm: () => void;
}) {
	const trigger = useRef<HTMLButtonElement>(null);
	return (
		<DestructiveConfirmation
			pending={false}
			triggerRef={trigger}
			onClose={props.onClose}
			errorMessage={undefined}
			pendingLabel="Removing..."
			onConfirm={props.onConfirm}
			actionLabel="Remove from collection"
			title={`Remove ${itemCount(props.count)} from ${props.name}?`}
			detail="The items stay in your library; only their memberships and details are removed."
		/>
	);
}

function AddConfirmation(props: {
	readonly count: number;
	readonly onClose: () => void;
	readonly onBack: undefined | (() => void);
	readonly onConfirm: (properties: unknown) => void;
	readonly header: NonNullable<CollectionHeaderResult>;
}) {
	const schema = membershipSchema(props.header);
	const hasFields = hasMembershipFields(schema);
	const form = useMembershipForm({
		schema,
		properties: undefined,
		onSubmit: props.onConfirm,
		seedKey: props.header.entityId,
	});
	return (
		<Dialog
			onClose={props.onClose}
			closeLabel="Close collection"
			title={`Add ${itemCount(props.count)} to ${props.header.name}`}
			description={
				hasFields
					? `The details below will be applied to all ${itemCount(props.count)}.`
					: "Items already in this collection keep their details."
			}
			footer={
				<>
					{props.onBack === undefined ? null : (
						<Button
							variant="ghost"
							className="mr-auto"
							onClick={props.onBack}
							aria-label="Back to collections"
						>
							<AppIcon size={16} name="chevron-left" />
							Back
						</Button>
					)}
					<Button onClick={() => void form.handleSubmit()}>Add to collection</Button>
				</>
			}
		>
			{hasFields ? <MembershipFields form={form} schema={schema} disabled={false} /> : undefined}
		</Dialog>
	);
}

function MembershipProgress(props: {
	readonly name: string;
	readonly run: MembershipRun;
	readonly onClose: () => void;
	readonly onRetry: () => void;
	readonly kind: MembershipChange["kind"];
}) {
	const { run } = props;
	const words = copy[props.kind];
	const settled = run.succeeded + run.failed.length;
	const title = `${words.active} ${props.kind === "add" ? "to" : "from"} ${props.name}`;
	return (
		<Dialog
			title={title}
			onClose={props.onClose}
			closeLabel="Close progress"
			footer={
				<Button onClick={props.onClose} variant={run.running ? "ghost" : "primary"}>
					{run.running ? "Stop" : "Done"}
				</Button>
			}
		>
			<div className="grid gap-3">
				{run.running ? (
					<>
						<p role="status">
							{`${words.active} ${settled.toLocaleString()} of ${itemCount(run.total)}…`}
						</p>
						<ProgressBar tone="accent" label={title} max={run.total} value={settled} />
					</>
				) : (
					<p role="status">{`${words.done} ${itemCount(run.succeeded)}.`}</p>
				)}
				{!run.running && run.failed.length > 0 ? (
					<Notice
						tone="danger"
						action={
							<Button variant="secondary" onClick={props.onRetry}>
								Retry failed
							</Button>
						}
					>
						{`${itemCount(run.failed.length)} ${words.failed}.`}
					</Notice>
				) : null}
			</div>
		</Dialog>
	);
}

function ChosenCollection(props: {
	readonly complete: Complete;
	readonly collectionId: EntityId;
	readonly kind: MembershipChange["kind"];
	readonly entityIds: readonly EntityId[];
	readonly onBack: undefined | (() => void);
}) {
	const header = useRyotQuery(collectionHeaderQuery, props.collectionId, {
		refreshOnMutation: false,
	});
	const membership = useMembershipRun();
	const close = () => {
		membership.stop();
		props.complete({ kind: membership.changed() ? "changed" : "cancelled" });
	};
	if (!header.data) {
		return (
			<CollectionLoadDialog
				onClose={close}
				title="Collection"
				failed={header.isError}
				onRetry={header.refetch}
				closeLabel="Close collection"
				missing={header.data === null}
			/>
		);
	}
	if (membership.run !== null) {
		return (
			<MembershipProgress
				onClose={close}
				kind={props.kind}
				run={membership.run}
				name={header.data.name}
				onRetry={membership.retryFailed}
			/>
		);
	}
	return props.kind === "add" ? (
		<AddConfirmation
			onClose={close}
			header={header.data}
			onBack={props.onBack}
			count={props.entityIds.length}
			onConfirm={(properties) =>
				membership.start(
					{ properties, kind: "add", collectionId: props.collectionId },
					props.entityIds,
				)
			}
		/>
	) : (
		<RemoveConfirmation
			onClose={close}
			name={header.data.name}
			count={props.entityIds.length}
			onConfirm={() =>
				membership.start({ kind: "remove", collectionId: props.collectionId }, props.entityIds)
			}
		/>
	);
}
