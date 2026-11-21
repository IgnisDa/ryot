import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { EntitySchemaSlug } from "@ryot-app/plugin-client-sdk/plugin";
import {
	createRyotMutation,
	formatConflict,
	formatError,
	type RyotSubmission,
	usePluginIdentity,
	useRyot,
	useRyotSchedule,
	useRyotSubmission,
	useT,
} from "@ryot-app/plugin-client-sdk/react";
import { DestructiveConfirmation, MenuButton } from "@ryot-app/plugin-ui-sdk";
import { useEffect, useRef, useState } from "react";

import { mediaLibraryMemberEntitySchemaSlugs } from "../../shared/media-schema-slugs";
import {
	type MediaUserDataAction,
	MediaUserDataInput,
	MediaUserDataOutput,
} from "../../shared/media-user-data-operations";
import { mediaUserDataDestinationRecipe } from "../../shared/media-user-data-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { type MediaText, useMediaMessages } from "../messages";
import { useMediaReminders } from "./reminders";
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
		submittedAt: input.submittedAt,
		inputSchema: MediaUserDataInput,
		idempotencyKey: input.submissionId,
		input: { ...input.input, submittedAt: input.submittedAt, submissionId: input.submissionId },
	}),
);

const isMediaLibraryMemberSchemaSlug = (slug: string): slug is MediaLibraryMemberEntitySchemaSlug =>
	mediaLibraryMemberEntitySchemaSlugs.some((candidate) => candidate === slug);

const submissionErrorFallback = (text: MediaText, error: Error) => {
	if (!(error instanceof RyotClientError)) {
		return text("user-data.error-retry");
	}
	if (error.reason === "transport") {
		return text("user-data.error-transport");
	}
	return (
		formatConflict(
			error,
			{
				"state-conflict": text("user-data.error-state-conflict"),
				"entity-not-found": text("user-data.error-entity-not-found"),
				"child-mapping-conflict": text("user-data.error-child-mapping-conflict"),
			},
			text("user-data.error-retry"),
		) ?? text("user-data.error-retry")
	);
};

export function MediaUserDataControl(props: { readonly media: MediaEntitySummaryValue }) {
	const { media } = props;
	const t = useT();
	const text = useMediaMessages();
	const reminders = useMediaReminders({ entityId: media.id });
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
		if (output === undefined || confirmation === undefined || handledOutput.current === output) {
			return;
		}
		handledOutput.current = output;
		if (confirmation.action === "merge") {
			client.navigation.replace({ kind: "entity", entityId: confirmation.target.id });
		}
		client.mutationCompleted.hint();
	}, [client, confirmation, submission.data]);

	const entitySchemaSlug = isMediaLibraryMemberSchemaSlug(media.schemaSlug)
		? media.schemaSlug
		: undefined;
	const resetSubmission = () => {
		submission.abandon();
		submission.reset();
	};
	const beginRemove = () => {
		if (entitySchemaSlug === undefined) {
			return;
		}
		resetSubmission();
		setPickerError(undefined);
		setConfirmation({
			action: "remove",
			intent: { action: "remove", entitySchemaSlug, entityId: media.id },
		});
	};
	const beginMerge = () => {
		if (entitySchemaSlug === undefined) {
			return;
		}
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
							return Effect.sync(() => setPickerError(text("user-data.pick-one")));
						}
						if (targetId === media.id) {
							return Effect.sync(() => setPickerError(text("user-data.pick-different")));
						}
						return client.data
							.query(
								mediaUserDataDestinationRecipe({
									reference: client.pluginIdentity(PLUGIN_PACKAGE_ID),
								}),
								{ entitySchemaSlug, entityId: targetId },
							)
							.pipe(
								Effect.flatMap((target) => {
									if (
										target === null ||
										target.entitySchemaSlug !== entitySchemaSlug ||
										target.entitySchemaPluginId !== identity.pluginId
									) {
										return Effect.sync(() => setPickerError(text("user-data.pick-same-type")));
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
					Effect.catch(() => Effect.sync(() => setPickerError(text("user-data.picker-failed")))),
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
	const errorMessage =
		submission.error === null
			? undefined
			: formatError(t, submission.error, submissionErrorFallback(text, submission.error));
	const activeConfirmation = submission.data === undefined ? confirmation : undefined;
	const retained = submission.status === "retained";

	return (
		<>
			<MenuButton
				disabled={isPicking}
				triggerRef={triggerRef}
				label={text("user-data.menu")}
				items={[
					reminders.item,
					...(entitySchemaSlug === undefined
						? []
						: [
								{
									key: "remove",
									destructive: true,
									onSelect: beginRemove,
									label: text("user-data.remove"),
								},
								{ key: "merge", onSelect: beginMerge, label: text("user-data.merge") },
							]),
				]}
			/>
			{reminders.error}
			{pickerError === undefined ? null : (
				<span role="alert" className="text-xs text-danger">
					{pickerError}
				</span>
			)}
			{activeConfirmation === undefined ? null : (
				<DestructiveConfirmation
					onConfirm={confirm}
					triggerRef={triggerRef}
					onClose={closeConfirmation}
					errorMessage={errorMessage}
					pending={submission.isPending}
					pendingLabel={
						activeConfirmation.action === "remove"
							? text("user-data.removing")
							: text("user-data.merging")
					}
					title={
						activeConfirmation.action === "remove"
							? text("user-data.remove-title")
							: text("user-data.merge-title")
					}
					actionLabel={
						activeConfirmation.action === "remove"
							? text(retained ? "user-data.retry-removal" : "user-data.remove-action")
							: text(retained ? "user-data.retry-merge" : "user-data.merge-action")
					}
					detail={
						activeConfirmation.action === "remove"
							? text("user-data.remove-detail", { name: media.name })
							: text("user-data.merge-detail", {
									name: media.name,
									target: activeConfirmation.target.name,
								})
					}
				/>
			)}
		</>
	);
}
