import type { EntityId } from "@ryot-app/contract/schema/brands";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
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

export function ChangeCollectionMembers(props: {
	readonly complete: Complete;
	readonly request: ChangeCollectionMembersRequest;
}) {
	const t = useT();
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
				closeLabel={t(kernelMessage("client.collections.picker.close"))}
				title={t(
					kernelMessage("client.collections.change.add-title", { count: request.entityIds.length }),
				)}
				footer={
					<Button variant="ghost" onClick={cancel}>
						{t(kernelMessage("common.action.cancel"))}
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
	const t = useT();
	const trigger = useRef<HTMLButtonElement>(null);
	return (
		<DestructiveConfirmation
			pending={false}
			triggerRef={trigger}
			onClose={props.onClose}
			errorMessage={undefined}
			onConfirm={props.onConfirm}
			pendingLabel={t(kernelMessage("client.collections.removing"))}
			detail={t(kernelMessage("client.collections.change.remove-detail"))}
			actionLabel={t(kernelMessage("client.collections.remove-from-collection"))}
			title={t(
				kernelMessage("client.collections.change.remove-title", {
					name: props.name,
					count: props.count,
				}),
			)}
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
	const t = useT();
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
			closeLabel={t(kernelMessage("client.collections.close"))}
			title={t(
				kernelMessage("client.collections.change.add-confirm-title", {
					count: props.count,
					name: props.header.name,
				}),
			)}
			description={t(
				hasFields
					? kernelMessage("client.collections.change.add-details", { count: props.count })
					: kernelMessage("client.collections.change.add-no-details"),
			)}
			footer={
				<>
					{props.onBack === undefined ? null : (
						<Button
							variant="ghost"
							className="mr-auto"
							onClick={props.onBack}
							aria-label={t(kernelMessage("client.collections.back-to-collections"))}
						>
							<AppIcon size={16} name="chevron-left" />
							{t(kernelMessage("common.action.back"))}
						</Button>
					)}
					<Button onClick={() => void form.handleSubmit()}>
						{t(kernelMessage("sdk.selection.add-to-collection"))}
					</Button>
				</>
			}
		>
			{hasFields ? <MembershipFields form={form} schema={schema} disabled={false} /> : undefined}
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
	const t = useT();
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
				failed={header.isError}
				onRetry={header.refetch}
				missing={header.data === null}
				title={t(kernelMessage("client.collections.load.title"))}
				closeLabel={t(kernelMessage("client.collections.close"))}
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

function MembershipProgress(props: {
	readonly name: string;
	readonly run: MembershipRun;
	readonly onClose: () => void;
	readonly onRetry: () => void;
	readonly kind: MembershipChange["kind"];
}) {
	const t = useT();
	const { run } = props;
	const settled = run.succeeded + run.failed.length;
	const title = t(
		kernelMessage(
			props.kind === "add"
				? "client.collections.change.add-progress-title"
				: "client.collections.change.remove-progress-title",
			{ name: props.name },
		),
	);
	return (
		<Dialog
			title={title}
			onClose={props.onClose}
			closeLabel={t(kernelMessage("client.collections.change.close-progress"))}
			footer={
				<Button onClick={props.onClose} variant={run.running ? "ghost" : "primary"}>
					{t(kernelMessage(run.running ? "common.action.stop" : "common.action.done"))}
				</Button>
			}
		>
			<div className="grid gap-3">
				{run.running ? (
					<>
						<p role="status">
							{t(
								kernelMessage(
									props.kind === "add"
										? "client.collections.change.add-running"
										: "client.collections.change.remove-running",
									{ settled, total: run.total },
								),
							)}
						</p>
						<ProgressBar tone="accent" label={title} max={run.total} value={settled} />
					</>
				) : (
					<p role="status">
						{t(
							kernelMessage(
								props.kind === "add"
									? "client.collections.change.add-done"
									: "client.collections.change.remove-done",
								{ count: run.succeeded },
							),
						)}
					</p>
				)}
				{!run.running && run.failed.length > 0 ? (
					<Notice
						tone="danger"
						action={
							<Button variant="secondary" onClick={props.onRetry}>
								{t(kernelMessage("client.collections.change.retry-failed"))}
							</Button>
						}
					>
						{t(
							kernelMessage(
								props.kind === "add"
									? "client.collections.change.add-failed"
									: "client.collections.change.remove-failed",
								{ count: run.failed.length },
							),
						)}
					</Notice>
				) : null}
			</div>
		</Dialog>
	);
}
