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
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { mediaOwnedLabel } from "./summary-state";

const setOwnership = createRyotBackgroundSubmission({
	slug: "media-ownership-set",
	packageId: PLUGIN_PACKAGE_ID,
	inputSchema: MediaOwnershipSetInput,
	input: ({ input }: { readonly input: MediaOwnershipSetInput }) => input,
	label: (input: MediaOwnershipSetInput) =>
		input.owned ? "Marked as owned" : "Marked as not owned",
});

export function MediaOwnershipControl(props: {
	readonly entityId: string;
	readonly owned: null | boolean;
	readonly ownedOn: null | string;
}) {
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
		ownership.submit(input, onAccepted === undefined ? {} : { onAccepted });
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
				{owned ? mediaOwnedLabel(ownedOn) : "Mark owned"}
			</ChipButton>
			{rolledBack && !dialogOpen ? (
				<span role="alert" className="text-xs text-danger">
					Unable to change ownership. Try again.
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
			title="Mark as owned"
			onClose={props.onClose}
			initialFocusRef={dateRef}
			closeLabel="Close ownership"
			dismissible={!props.sending}
		>
			<ActionForm onSubmit={save} label="Mark as owned" className="flex flex-col gap-4">
				<Field
					optional
					label="Owned on"
					error={invalid ? "Pick a date that is not in the future." : undefined}
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
					<StatusMessage tone="error">Couldn't start saving ownership. Try again.</StatusMessage>
				) : null}
				<div className="flex gap-2">
					<Button type="button" onClick={save} disabled={invalid || props.sending}>
						{props.sending ? "Saving…" : "Save"}
					</Button>
					<Button
						type="button"
						variant="secondary"
						onClick={props.onClose}
						disabled={props.sending}
					>
						Cancel
					</Button>
				</div>
			</ActionForm>
		</Dialog>
	);
}
