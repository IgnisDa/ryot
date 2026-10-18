import {
	localDay,
	useBackgroundSubmission,
	usePluginIdentity,
	usePluginUserSettings,
	useRyotQuery,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
import { ActionForm, Button, Dialog, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { type RefObject, useState } from "react";

import type { MediaActivityLogContext } from "../../../shared/activity-log-recipes";
import { consumedOnSettingKey } from "../../../shared/consumed-on-settings";
import { mediaActivityPatchableKeys } from "../../../shared/media-activity-fields";
import { PLUGIN_PACKAGE_ID } from "../../../shared/plugin-identity";
import type { MediaActivityEventRef } from "../activity-timeline";
import { activityLogContextQuery, updateActivitySubmission } from "./queries";
import { FlatProgress, PositionProgress, SourceField, TimeSpentField, WhenField } from "./sheet";
import {
	type ActivityDraft,
	activityDraftErrors,
	activityEditDraft,
	type ActivityEditIntent,
	activityEditPatch,
	activityRuntimeHint,
	consumedOnSuggestions,
	eventPrecondition,
	hasActivityErrors,
	type MediaActivityLogger,
} from "./state";

type EditSheetProps = {
	readonly compact: boolean;
	readonly onClose: () => void;
	readonly record: MediaActivityEventRef;
	readonly intent: ActivityEditIntent;
	readonly logger: MediaActivityLogger;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
};

function EditFields(props: {
	readonly today: string;
	readonly draft: ActivityDraft;
	readonly logger: MediaActivityLogger;
	readonly suggestions: readonly string[];
	readonly context: MediaActivityLogContext;
	readonly ownProgress: boolean;
	readonly onChange: (patch: Partial<ActivityDraft>) => void;
}) {
	const { draft, today, logger, context } = props;
	const errors = activityDraftErrors({ draft, today, logger, context });
	return (
		<>
			{draft.intent === "progress" && logger.family === "positional" && props.ownProgress ? (
				<PositionProgress
					draft={draft}
					logger={logger}
					context={context}
					error={errors.position}
					onChange={props.onChange}
				/>
			) : null}
			{draft.intent === "progress" && !(logger.family === "positional" && props.ownProgress) ? (
				<FlatProgress
					draft={draft}
					logger={logger}
					context={context}
					error={errors.percent}
					onChange={props.onChange}
				/>
			) : null}
			{draft.intent === "progress" ? null : (
				<WhenField
					today={today}
					draft={draft}
					logger={logger}
					error={errors.when}
					onChange={props.onChange}
					kinds={["date", "unknown"]}
				/>
			)}
			{draft.intent === "finished" ? (
				<TimeSpentField
					draft={draft}
					label="Time spent"
					error={errors.time}
					onChange={props.onChange}
					hint={activityRuntimeHint(context.runtime)}
				/>
			) : null}
			<SourceField
				logger={logger}
				value={draft.consumedOn}
				error={errors.consumedOn}
				suggestions={props.suggestions}
				onChange={(consumedOn) => props.onChange({ consumedOn })}
			/>
		</>
	);
}

function EditForm(props: EditSheetProps & { readonly context: MediaActivityLogContext }) {
	const { logger, record, context } = props;
	const schedule = useRyotSchedule();
	const today = localDay(schedule.now());
	const update = useBackgroundSubmission(updateActivitySubmission);
	const [initial] = useState(() =>
		activityEditDraft({ today, logger, context, ref: record, intent: props.intent }),
	);
	const [draft, setDraft] = useState(initial);
	const settings = usePluginUserSettings(usePluginIdentity(PLUGIN_PACKAGE_ID).pluginId);
	const settingKey = consumedOnSettingKey(context.schemaSlug);
	const suggestions = consumedOnSuggestions(
		settingKey === undefined ? undefined : settings.data?.[settingKey],
		context.consumedOn,
	);
	const errors = activityDraftErrors({ draft, today, logger, context });
	const patchAt = (submittedAt: string) =>
		activityEditPatch({ draft, logger, initial, context, submittedAt, ref: record });
	const unchanged = patchAt(new Date(schedule.now()).toISOString()) === undefined;
	const save = () => {
		const patch = patchAt(new Date(schedule.now()).toISOString());
		if (patch === undefined || hasActivityErrors(errors) || update.isSending) {
			return;
		}
		update.submit(
			{
				patch,
				eventId: record.id,
				expected: eventPrecondition(record, mediaActivityPatchableKeys),
			},
			{ onAccepted: props.onClose },
		);
	};
	return (
		<Dialog
			title="Edit activity"
			onClose={props.onClose}
			triggerRef={props.triggerRef}
			dismissible={!update.isSending}
			closeLabel="Close edit activity"
			placement={props.compact ? "sheet" : "center"}
			footer={
				<>
					<Button variant="secondary" onClick={props.onClose} disabled={update.isSending}>
						Cancel
					</Button>
					<Button
						onClick={save}
						loading={update.isSending}
						disabled={unchanged || hasActivityErrors(errors)}
					>
						Save changes
					</Button>
				</>
			}
		>
			<ActionForm onSubmit={save} label="Edit activity" className="flex flex-col gap-4">
				<fieldset disabled={update.isSending} className="flex min-w-0 flex-col gap-4">
					<EditFields
						draft={draft}
						today={today}
						logger={logger}
						context={context}
						suggestions={suggestions}
						ownProgress={record.entityId === context.id}
						onChange={(next) => setDraft((current) => ({ ...current, ...next }))}
					/>
				</fieldset>
				{update.error === null ? null : (
					<StatusMessage tone="error">Couldn't start saving. Try again.</StatusMessage>
				)}
			</ActionForm>
		</Dialog>
	);
}

/** Edits one stored completion or progress update with the Log activity fields. */
export function MediaActivityEditSheet(props: EditSheetProps & { readonly entityId: string }) {
	const result = useRyotQuery(activityLogContextQuery, { entityId: props.entityId });
	if (result.data === undefined || result.data === null) {
		let message = "Loading…";
		if (result.data === null) {
			message = "This activity can't be edited.";
		} else if (result.isError) {
			message = "Unable to load this item.";
		}
		return (
			<Dialog
				title="Edit activity"
				onClose={props.onClose}
				triggerRef={props.triggerRef}
				closeLabel="Close edit activity"
				placement={props.compact ? "sheet" : "center"}
			>
				<StatusMessage
					tone={result.isError ? "error" : "pending"}
					action={result.isError ? { label: "Try again", onClick: result.refetch } : undefined}
				>
					{message}
				</StatusMessage>
			</Dialog>
		);
	}
	return <EditForm {...props} context={result.data} />;
}
