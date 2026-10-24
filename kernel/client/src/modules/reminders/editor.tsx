import {
	REMINDER_MESSAGE_MAX_LENGTH,
	ReminderConflict,
	ReminderInvalid,
} from "@ryot-app/contract/modules/reminders/schemas";
import type { EntityId } from "@ryot-app/contract/schema/brands";
import { deviceTimeZone } from "@ryot-app/contract/schema/time-zone";
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

import { ReminderReadiness } from "./readiness";
import { type ReminderCommand, reminderCommandMutation } from "./service";

type Reminder = RemindersResult["items"][number];
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
		detail: string;
		retry: boolean;
		reload: boolean;
	}>(null);
	const pending = useRef<null | ReminderCommand>(null);
	const resolution = resolveDateTimeInput(wallTime, original, occurrence, timezone);
	const zones = [...new Set(["UTC", timezone, ...Intl.supportedValuesOf("timeZone")])].map(
		(zone) => ({ value: zone, label: zone }),
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
					detail: resolution.error ?? "Enter a message and a future date and time.",
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
							payload: { ...submission, revision: initial.revision },
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
								detail: "This reminder changed. Reload before you continue.",
							});
						} else if (Schema.is(ReminderInvalid)(cause)) {
							pending.current = null;
							setFailure({
								retry: false,
								reload: cause.reason === "invalid-state",
								detail:
									cause.reason === "invalid-state"
										? "Processing has started. Reload this reminder."
										: "Check the message, future date and time, timezone and entity scope.",
							});
						} else {
							setFailure({
								retry: true,
								reload: false,
								detail:
									"The result could not be confirmed. Retry sends the same submission, not a new reminder.",
							});
						}
					},
				}),
			),
		);
	};
	const locked = mutation.isPending || failure?.retry === true || failure?.reload === true;
	let saveLabel = editing ? "Save reminder" : "Schedule reminder";
	if (failure?.retry) {
		saveLabel = "Retry submission";
	}
	return (
		<Dialog
			onClose={props.onClose}
			dismissible={!mutation.isPending}
			closeLabel="Close reminder editor"
			title={editing ? "Edit reminder" : "Schedule reminder"}
			footer={
				<>
					<Button variant="secondary" onClick={props.onClose} disabled={mutation.isPending}>
						Cancel
					</Button>
					{failure?.reload ? (
						<Button onClick={props.onReload}>Reload</Button>
					) : (
						<Button onClick={save} loading={mutation.isPending} disabled={mutation.isPending}>
							{saveLabel}
						</Button>
					)}
				</>
			}
		>
			<div className="grid gap-4">
				<p className="text-sm text-text-muted">
					Server reminders use your enabled notification channels. Delivery is checked every five
					minutes by default; this is not a precise alarm.
				</p>
				<ReminderReadiness />
				{initial?.originalSchedule ? (
					<Notice tone="info">
						Original schedule:{" "}
						{initial.originalSchedule.date ?? initial.originalSchedule.dueAt ?? "Not available"}
						{initial.originalSchedule.timezone ? ` (${initial.originalSchedule.timezone})` : ""}.
						Choose a new future time.
						{initial.originalSchedule.mayHaveSent
							? " The original occurrence may already have sent a notification."
							: ""}
					</Notice>
				) : null}
				<fieldset disabled={locked} className="grid gap-4 border-0 p-0">
					<Field label="Message">
						{(control) => (
							<TextArea
								{...control}
								autoFocus
								value={message}
								maxLength={REMINDER_MESSAGE_MAX_LENGTH}
								onChange={(event) => setMessage(event.currentTarget.value)}
							/>
						)}
					</Field>
					<Field label="Date and time" error={wallTime === "" ? undefined : resolution.error}>
						{(control) => (
							<TextField
								{...control}
								step="any"
								value={wallTime}
								type="datetime-local"
								onChange={(event) => {
									setWallTime(event.currentTarget.value);
									setOccurrence("");
								}}
							/>
						)}
					</Field>
					<Select
						{...selectIcons}
						choices={zones}
						label="Timezone"
						value={timezone}
						searchIcon={<AppIcon size={16} name="search" />}
						onChange={(zone) => {
							setTimezone(zone);
							setOccurrence("");
						}}
					/>
					{resolution.choices.length > 1 ? (
						<Select
							{...selectIcons}
							label="Time occurrence"
							onChange={setOccurrence}
							choices={resolution.choices}
							value={resolution.occurrence}
							placeholder="Choose an occurrence"
						/>
					) : null}
				</fieldset>
				<p className="text-sm text-text-muted">
					This saves one fixed instant. Travel and device timezone changes do not move it.
				</p>
				{failure ? <Notice tone="danger">{failure.detail}</Notice> : null}
			</div>
		</Dialog>
	);
}
