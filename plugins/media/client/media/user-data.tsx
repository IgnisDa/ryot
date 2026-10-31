import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { EntitySchemaSlug } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotMutation,
	type RyotSubmission,
	usePluginIdentity,
	useRyot,
	useRyotSchedule,
	useRyotSubmission,
} from "@ryot-app/plugin-client-sdk/react";
import { DestructiveConfirmation, IconButton, MenuButton } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useEffect, useRef, useState } from "react";

import { mediaLibraryMemberEntitySchemaSlugs } from "../../shared/media-schema-slugs";
import {
	type MediaUserDataAction,
	MediaUserDataInput,
	MediaUserDataOutput,
} from "../../shared/media-user-data-operations";
import { mediaUserDataDestinationRecipe } from "../../shared/media-user-data-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import type { MediaEntitySummaryValue } from "./summary-state";

type MergeAction = Extract<MediaUserDataAction, { readonly action: "merge" }>;
type RemoveAction = Extract<MediaUserDataAction, { readonly action: "remove" }>;
type MediaLibraryMemberEntitySchemaSlug = (typeof mediaLibraryMemberEntitySchemaSlugs)[number];

type UserDataConfirmation =
	| { readonly action: "remove"; readonly intent: RemoveAction }
	| {
			readonly action: "merge";
			readonly intent: MergeAction;
			readonly target: { readonly id: string; readonly name: string };
	  };

const mediaUserDataMutation = createRyotMutation<
	RyotSubmission<MediaUserDataAction>,
	MediaUserDataOutput
>(({ input, client }) =>
	client.operations.invoke({
		slug: "media-user-data",
		refreshOnSuccess: false,
		output: MediaUserDataOutput,
		packageId: PLUGIN_PACKAGE_ID,
		inputSchema: MediaUserDataInput,
		idempotencyKey: input.submissionId,
		input: { ...input.input, submittedAt: input.submittedAt, submissionId: input.submissionId },
	}),
);

const isMediaLibraryMemberSchemaSlug = (slug: string): slug is MediaLibraryMemberEntitySchemaSlug =>
	mediaLibraryMemberEntitySchemaSlugs.some((candidate) => candidate === slug);

const submissionErrorMessage = (error: null | Error) => {
	if (error === null) {
		return undefined;
	}
	if (error instanceof RyotClientError && error.reason === "operation-failed") {
		return "This action could not be completed. Demo accounts cannot change media data.";
	}
	if (error instanceof RyotClientError && error.reason === "transport") {
		return "Couldn't reach the server. Retry to finish this change safely.";
	}
	return "Couldn't finish this change. Retry to confirm the result safely.";
};

export function MediaUserDataControl(props: { readonly media: MediaEntitySummaryValue }) {
	const { media } = props;
	const identity = usePluginIdentity(PLUGIN_PACKAGE_ID);
	const client = useRyot();
	const schedule = useRyotSchedule();
	const submission = useRyotSubmission(mediaUserDataMutation);
	const triggerRef = useRef<null | HTMLButtonElement>(null);
	const [confirmation, setConfirmation] = useState<UserDataConfirmation>();
	const [pickerError, setPickerError] = useState<string | undefined>();
	const [isPicking, setIsPicking] = useState(false);
	const handledOutput = useRef<undefined | MediaUserDataOutput>(undefined);

	useEffect(() => {
		const output = submission.data;
		if (
			output?.status !== "saved" ||
			confirmation === undefined ||
			handledOutput.current === output
		) {
			return;
		}
		handledOutput.current = output;
		if (confirmation.action === "merge") {
			client.navigation.replace({ kind: "entity", entityId: confirmation.target.id });
		}
		client.mutationCompleted.hint();
	}, [client, confirmation, submission.data]);

	if (!isMediaLibraryMemberSchemaSlug(media.schemaSlug)) {
		return null;
	}
	const entitySchemaSlug = media.schemaSlug;
	const resetSubmission = () => {
		submission.abandon();
		submission.reset();
	};
	const beginRemove = () => {
		resetSubmission();
		setPickerError(undefined);
		setConfirmation({
			action: "remove",
			intent: { action: "remove", entitySchemaSlug, entityId: media.id },
		});
	};
	const beginMerge = () => {
		setPickerError(undefined);
		setIsPicking(true);
		schedule.run(
			client.screens
				.pickEntity({
					schema: {
						slug: EntitySchemaSlug.make(entitySchemaSlug),
						owner: { kind: "plugin", pluginId: identity.pluginId },
					},
				})
				.pipe(
					Effect.flatMap((outcome) => {
						if (outcome.kind !== "selected") {
							return Effect.void;
						}
						const [targetId, ...others] = outcome.entityIds;
						if (targetId === undefined || others.length > 0) {
							return Effect.sync(() => setPickerError("Select exactly one merge destination."));
						}
						if (targetId === media.id) {
							return Effect.sync(() =>
								setPickerError("Choose a different media item as the merge destination."),
							);
						}
						return client.data
							.query(
								mediaUserDataDestinationRecipe({
									entitySchemaSlug,
									entityId: targetId,
									reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
								}),
							)
							.pipe(
								Effect.flatMap((target) => {
									if (
										target === null ||
										target.entitySchemaSlug !== entitySchemaSlug ||
										target.entitySchemaPluginId !== identity.pluginId
									) {
										return Effect.sync(() =>
											setPickerError("Choose an existing item of the same media type."),
										);
									}
									resetSubmission();
									return Effect.sync(() =>
										setConfirmation({
											action: "merge",
											target: { id: target.id, name: target.name },
											intent: {
												action: "merge",
												entitySchemaSlug,
												mergeFrom: media.id,
												mergeInto: target.id,
											},
										}),
									);
								}),
							);
					}),
					Effect.catch(() =>
						Effect.sync(() => setPickerError("Couldn't open the entity picker. Try again.")),
					),
				),
			() => setIsPicking(false),
		);
	};
	const closeConfirmation = () => {
		setConfirmation(undefined);
		resetSubmission();
	};
	const confirm = () => {
		if (confirmation === undefined || submission.isPending) {
			return;
		}
		if (submission.status === "retained") {
			submission.retry();
			return;
		}
		submission.reset();
		submission.submit(confirmation.intent);
	};
	const rejectedMessage =
		submission.data?.status === "rejected" ? submission.data.message : undefined;
	const errorMessage = rejectedMessage ?? submissionErrorMessage(submission.error);
	const activeConfirmation = submission.data?.status === "saved" ? undefined : confirmation;
	let actionLabel = "";
	if (activeConfirmation?.action === "remove") {
		actionLabel = submission.status === "retained" ? "Retry removal" : "Remove data";
	} else if (activeConfirmation?.action === "merge") {
		actionLabel = submission.status === "retained" ? "Retry merge" : "Merge data";
	}

	return (
		<>
			<MenuButton
				label="Your data"
				disabled={isPicking}
				items={[
					{ key: "remove", destructive: true, onSelect: beginRemove, label: "Remove from library" },
					{ key: "merge", onSelect: beginMerge, label: "Merge my data into…" },
				]}
				renderTrigger={(trigger) => (
					<IconButton
						size="sm"
						label="Your data"
						disabled={isPicking}
						onClick={trigger.onClick}
						aria-haspopup={trigger["aria-haspopup"]}
						aria-expanded={trigger["aria-expanded"]}
						ref={(element) => {
							triggerRef.current = element;
							trigger.ref(element);
						}}
					>
						<AppIcon size={16} name="more-horizontal" />
					</IconButton>
				)}
			/>
			{pickerError === undefined ? null : (
				<span role="alert" className="text-xs text-danger">
					{pickerError}
				</span>
			)}
			{activeConfirmation === undefined ? null : (
				<DestructiveConfirmation
					onConfirm={confirm}
					triggerRef={triggerRef}
					actionLabel={actionLabel}
					onClose={closeConfirmation}
					errorMessage={errorMessage}
					pending={submission.isPending}
					pendingLabel={activeConfirmation.action === "remove" ? "Removing…" : "Merging…"}
					title={
						activeConfirmation.action === "remove"
							? "Remove your media data?"
							: "Merge your media data?"
					}
					detail={
						activeConfirmation.action === "remove"
							? `Remove all your data for “${media.name}”? This removes your history, reviews, ownership, monitoring, collection memberships, and child data. Media metadata remains. Integrations may restore data.`
							: `Merge your data from “${media.name}” into “${activeConfirmation.target.name}”? Your history, reviews, ownership, monitoring, collection memberships, and child data move. Media metadata remains on both items. Integrations may restore data.`
					}
				/>
			)}
		</>
	);
}
