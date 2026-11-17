import type { LocalMessage } from "@ryot-app/plugin-client-sdk";
import {
	createRyotBackgroundSubmission,
	localDay,
	useBackgroundSubmission,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
import {
	ActionForm,
	Button,
	ChipButton,
	Dialog,
	Field,
	StatusMessage,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useRef, useState } from "react";

import { MediaOwnershipSetInput } from "../../shared/media-ownership-operations";
import { catalogMessage } from "../../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { useMediaCopy, useMediaMessages } from "../messages";
import { mediaOwnedLabel } from "./summary-state";

type OwnershipSubmission = MediaOwnershipSetInput & { readonly label: LocalMessage };

const setOwnership = createRyotBackgroundSubmission({
	slug: "media-ownership-set",
	packageId: PLUGIN_PACKAGE_ID,
	inputSchema: MediaOwnershipSetInput,
	label: (input: OwnershipSubmission) => input.label,
	input: ({ input: { label: _label, ...input } }: { readonly input: OwnershipSubmission }) => input,
});

export function MediaOwnershipControl(props: {
	readonly entityId: string;
	readonly owned: null | boolean;
	readonly ownedOn: null | string;
}) {
	const copy = useMediaCopy();
	const { text } = copy;
	const [dialogOpen, setDialogOpen] = useState(false);
	const ownership = useBackgroundSubmission(setOwnership);
	const [optimistic, setOptimistic] = useState<null | MediaOwnershipSetInput>(null);
	const rolledBack = ownership.last?.status === "failed" || ownership.error !== null;
	if (
		(props.owned === true) === optimistic?.owned &&
		(!optimistic.owned || props.ownedOn === optimistic.ownedOn)
	) {
		setOptimistic(null);
	}
	const intent = rolledBack ? null : optimistic;
	const owned = intent === null ? props.owned === true : intent.owned;
	const ownedOn = intent?.owned === true ? intent.ownedOn : props.ownedOn;
	const submit = (input: MediaOwnershipSetInput, onAccepted?: () => void) => {
		setOptimistic(input);
		ownership.submit(
			{
				...input,
				label: catalogMessage(
					input.owned ? "ownership.marked-owned" : "ownership.marked-not-owned",
				),
			},
			onAccepted === undefined ? {} : { onAccepted },
		);
	};
	return (
		<>
			<ChipButton
				pressed={owned}
				disabled={ownership.isSending}
				icon={<AppIcon size={13} name="box" />}
				onClick={() =>
					owned ? submit({ owned: false, entityIds: [props.entityId] }) : setDialogOpen(true)
				}
			>
				{owned ? mediaOwnedLabel(copy, ownedOn) : text("ownership.mark")}
			</ChipButton>
			{rolledBack && !dialogOpen ? (
				<span role="alert" className="text-xs text-danger">
					{text("ownership.failed")}
				</span>
			) : null}
			{dialogOpen ? (
				<MediaOwnedOnDialog
					sending={ownership.isSending}
					failed={ownership.error !== null}
					onClose={() => setDialogOpen(false)}
					onSave={(date) =>
						submit({ owned: true, ownedOn: date, entityIds: [props.entityId] }, () =>
							setDialogOpen(false),
						)
					}
				/>
			) : null}
		</>
	);
}

function MediaOwnedOnDialog(props: {
	readonly failed: boolean;
	readonly sending: boolean;
	readonly onClose: () => void;
	readonly onSave: (ownedOn: null | string) => void;
}) {
	const text = useMediaMessages();
	const schedule = useRyotSchedule();
	const today = localDay(schedule.now());
	const dateRef = useRef<HTMLInputElement>(null);
	const [ownedOn, setOwnedOn] = useState(today);
	const invalid = ownedOn > today;
	const save = () => {
		if (!invalid && !props.sending) {
			props.onSave(ownedOn === "" ? null : ownedOn);
		}
	};
	return (
		<Dialog
			onClose={props.onClose}
			initialFocusRef={dateRef}
			dismissible={!props.sending}
			title={text("ownership.title")}
			closeLabel={text("ownership.close")}
		>
			<ActionForm onSubmit={save} label={text("ownership.title")} className="flex flex-col gap-4">
				<Field
					optional
					label={text("property.owned-on")}
					error={invalid ? text("ownership.future") : undefined}
				>
					{(control) => (
						<TextField
							{...control}
							type="date"
							max={today}
							ref={dateRef}
							value={ownedOn}
							disabled={props.sending}
							onChange={(event) => setOwnedOn(event.currentTarget.value)}
						/>
					)}
				</Field>
				{props.failed ? (
					<StatusMessage tone="error">{text("ownership.save-failed")}</StatusMessage>
				) : null}
				<div className="flex gap-2">
					<Button type="button" onClick={save} disabled={invalid || props.sending}>
						{props.sending ? text("common.status.saving") : text("common.action.save")}
					</Button>
					<Button
						type="button"
						variant="secondary"
						onClick={props.onClose}
						disabled={props.sending}
					>
						{text("common.action.cancel")}
					</Button>
				</div>
			</ActionForm>
		</Dialog>
	);
}
