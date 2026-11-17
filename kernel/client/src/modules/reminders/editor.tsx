import {
	REMINDER_MESSAGE_MAX_LENGTH,
	ReminderConflict,
	ReminderInvalid,
} from "@ryot-app/contract/modules/reminders/schemas";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import { deviceTimeZone } from "@ryot-app/contract/schema/time-zone";
import { formatDisplayText } from "@ryot-app/i18n/format";
import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotMutation, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Dialog,
	Field,
	Notice,
	Select,
	TextArea,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { resolveDateTimeInput, toDateTimeInput } from "@ryot-app/plugin-ui-sdk/datetime";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { RemindersResult } from "@ryot-app/ryotql-recipes/reminders";
import { Effect, Schema } from "effect";
import { useRef, useState } from "react";

import { AuthenticatedApiError } from "#/api/authenticated";

import { type ReminderCommand, reminderCommandMutation } from "./service";

type Reminder = RemindersResult["items"][number];
type OriginalSchedule = NonNullable<Reminder["originalSchedule"]>;

const originalScheduleText = (t: (message: Message) => Text, schedule: OriginalSchedule) => {
	const value =
		schedule.date ?? schedule.dueAt ?? t(kernelMessage("client.reminders.not-available"));
	return schedule.timezone === null
		? value
		: t(
				kernelMessage("client.reminders.editor.schedule-with-zone", {
					value,
					timezone: schedule.timezone,
				}),
			);
};
const selectIcons = {
	checkIcon: <AppIcon size={16} name="check" />,
	chevronIcon: <AppIcon size={16} name="chevron-down" />,
};

export function ReminderEditor(props: {
	readonly entityId: EntityId;
	readonly onClose: () => void;
	readonly onSaved: () => void;
	readonly onReload: () => void;
	readonly initial?: Reminder | undefined;
	readonly parentEntityId: null | EntityId;
}) {
	const t = useT();
	const schedule = useRyotSchedule();
	const mutation = useRyotMutation(reminderCommandMutation);
	const initial = props.initial;
	const editing = initial?.state === "scheduled";
	const original = editing ? initial.dueAt : null;
	const [timezone, setTimezone] = useState<string>(initial?.timezone ?? deviceTimeZone());
	const [wallTime, setWallTime] = useState(() =>
		original === null ? "" : toDateTimeInput(original, timezone, "millisecond"),
	);
	const [message, setMessage] = useState(initial?.message ?? "");
	const [occurrence, setOccurrence] = useState("");
	const [failure, setFailure] = useState<null | {
		retry: boolean;
		detail: Message;
		reload: boolean;
	}>(null);
	const pending = useRef<null | ReminderCommand>(null);
	const resolution = resolveDateTimeInput(wallTime, original, occurrence, timezone);
	const zones = [...new Set(["UTC", timezone, ...Intl.supportedValuesOf("timeZone")])].map(
		(zone) => ({ value: zone, label: formatDisplayText(t, zone) }),
	);
	const save = () => {
		if (pending.current === null) {
			if (
				resolution.iso === null ||
				Date.parse(resolution.iso) <= schedule.now() ||
				message.trim() === ""
			) {
				setFailure({
					retry: false,
					reload: false,
					detail: resolution.error ?? kernelMessage("client.reminders.editor.incomplete"),
				});
				return;
			}
			const submission = {
				timezone,
				dueAt: resolution.iso,
				message: message.trim(),
				idempotencyKey: crypto.randomUUID(),
				submittedAt: new Date(schedule.now()).toISOString(),
			};
			pending.current = editing
				? {
						action: "edit",
						request: {
							params: { reminderId: initial.id },
							payload: {
								dueAt: submission.dueAt,
								revision: initial.revision,
								message: submission.message,
								timezone: submission.timezone,
							},
						},
					}
				: {
						action: "create",
						request: {
							payload: {
								...submission,
								entityId: props.entityId,
								parentEntityId: props.parentEntityId,
								replaces:
									initial === undefined ? null : { id: initial.id, revision: initial.revision },
							},
						},
					};
		}
		const command = pending.current;
		setFailure(null);
		void Effect.runPromise(
			mutation.mutateEffect(command).pipe(
				Effect.match({
					onSuccess: props.onSaved,
					onFailure: (error) => {
						const cause = error instanceof AuthenticatedApiError ? error.cause : undefined;
						if (Schema.is(ReminderConflict)(cause)) {
							setFailure({
								reload: true,
								retry: false,
								detail: kernelMessage("client.reminders.changed"),
							});
						} else if (Schema.is(ReminderInvalid)(cause)) {
							pending.current = null;
							setFailure({
								retry: false,
								reload: cause.reason === "invalid-state",
								detail:
									cause.reason === "invalid-state"
										? kernelMessage("client.reminders.editor.processing-started")
										: kernelMessage("client.reminders.editor.invalid"),
							});
						} else {
							setFailure({
								retry: true,
								reload: false,
								detail: kernelMessage("client.reminders.editor.unconfirmed"),
							});
						}
					},
				}),
			),
		);
	};
	const locked = mutation.isPending || failure?.retry === true || failure?.reload === true;
	let saveLabel = t(
		editing
			? kernelMessage("client.reminders.editor.save")
			: kernelMessage("client.reminders.schedule"),
	);
	if (failure?.retry) {
		saveLabel = t(kernelMessage("client.reminders.editor.retry-submission"));
	}
	return (
		<Dialog
			onClose={props.onClose}
			dismissible={!mutation.isPending}
			closeLabel={t(kernelMessage("client.reminders.editor.close"))}
			title={t(
				editing
					? kernelMessage("client.reminders.editor.edit")
					: kernelMessage("client.reminders.schedule"),
			)}
			footer={
				<>
					<Button variant="secondary" onClick={props.onClose} disabled={mutation.isPending}>
						{t(kernelMessage("common.action.cancel"))}
					</Button>
					{failure?.reload ? (
						<Button onClick={props.onReload}>{t(kernelMessage("common.action.reload"))}</Button>
					) : (
						<Button onClick={save} loading={mutation.isPending} disabled={mutation.isPending}>
							{saveLabel}
						</Button>
					)}
				</>
			}
		>
			<div className="grid gap-5">
				{initial?.originalSchedule ? (
					<Notice tone="info" icon={<AppIcon size={16} name="history" />}>
						{t(
							kernelMessage("client.reminders.editor.original-schedule", {
								schedule: originalScheduleText(t, initial.originalSchedule),
							}),
						)}
						{initial.originalSchedule.mayHaveSent ? (
							<> {t(kernelMessage("client.reminders.editor.may-have-sent"))}</>
						) : null}
					</Notice>
				) : null}
				<fieldset disabled={locked} className="grid gap-4 border-0 p-0">
					<Field label={t(kernelMessage("client.reminders.editor.message"))}>
						{(control) => (
							<TextArea
								{...control}
								rows={3}
								autoFocus
								value={message}
								maxLength={REMINDER_MESSAGE_MAX_LENGTH}
								onChange={(event) => setMessage(event.currentTarget.value)}
								placeholder={t(kernelMessage("client.reminders.editor.message-placeholder"))}
							/>
						)}
					</Field>
					<div className="grid gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
						<Field
							label={t(kernelMessage("client.reminders.editor.date-time"))}
							error={
								wallTime === "" || resolution.error === undefined ? undefined : t(resolution.error)
							}
						>
							{(control) => (
								<TextField
									{...control}
									step="any"
									value={wallTime}
									type="datetime-local"
									className="w-full min-w-0"
									onChange={(event) => {
										setWallTime(event.currentTarget.value);
										setOccurrence("");
									}}
								/>
							)}
						</Field>
						<div className="grid min-w-0 content-start gap-1.5">
							<span aria-hidden="true" className="text-label font-medium text-text">
								{t(kernelMessage("client.reminders.editor.timezone"))}
							</span>
							<Select
								{...selectIcons}
								choices={zones}
								value={timezone}
								searchIcon={<AppIcon size={16} name="search" />}
								label={t(kernelMessage("client.reminders.editor.timezone"))}
								onChange={(zone) => {
									setTimezone(zone);
									setOccurrence("");
								}}
							/>
						</div>
					</div>
					{resolution.choices.length > 1 ? (
						<Select
							{...selectIcons}
							onChange={setOccurrence}
							value={resolution.occurrence}
							label={t(kernelMessage("client.reminders.editor.occurrence"))}
							placeholder={t(kernelMessage("ui.datetime.choose-occurrence"))}
							choices={resolution.choices.map((choice) =>
								Object.assign({}, choice, { label: t(choice.label) }),
							)}
						/>
					) : null}
				</fieldset>
				<p className="flex gap-2 text-xs text-text-subtle">
					<AppIcon size={14} name="info" className="mt-px shrink-0" />
					{t(kernelMessage("client.reminders.editor.fixed-instant"))}
				</p>
				{failure ? <Notice tone="danger">{t(failure.detail)}</Notice> : null}
			</div>
		</Dialog>
	);
}
