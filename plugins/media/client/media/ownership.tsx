import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	createRyotMutation,
	localDay,
	useRyotMutation,
	useRyotSchedule,
} from "@ryot-app/plugin-client-sdk/react";
import {
	ActionForm,
	Button,
	Dialog,
	Field,
	Row,
	StatusMessage,
	Switch,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { useEffect, useRef, useState } from "react";

import {
	MediaOwnershipOutput,
	MediaOwnershipSetInput,
} from "../../shared/media-ownership-operations";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { mediaOwnershipLabel } from "./summary-state";

const setOwnership = createRyotMutation<MediaOwnershipSetInput, void>(({ input, client }) =>
	Effect.gen(function* () {
		const { results } = yield* client.operations.invoke({
			input,
			slug: "media-ownership-set",
			packageId: PLUGIN_PACKAGE_ID,
			output: MediaOwnershipOutput,
			inputSchema: MediaOwnershipSetInput,
		});
		const result = results[0];
		if (
			results.length !== 1 ||
			result?.status !== "found" ||
			result.entityId !== input.entityIds[0] ||
			result.owned !== input.owned ||
			result.ownedOn !== (input.owned ? input.ownedOn : null)
		) {
			return yield* new RyotClientError("malformed-result");
		}
		return undefined;
	}),
);

function MediaOwnedOnDialog(props: { readonly entityId: string; readonly onClose: () => void }) {
	const schedule = useRyotSchedule();
	const today = localDay(schedule.now());
	const dateRef = useRef<HTMLInputElement>(null);
	const [ownedOn, setOwnedOn] = useState(today);
	const mutation = useRyotMutation(setOwnership);
	const { onClose } = props;
	useEffect(() => {
		if (mutation.status === "success") {
			onClose();
		}
	}, [mutation.status, onClose]);
	const invalid = ownedOn > today;
	const save = () => {
		if (invalid || mutation.isPending) {
			return;
		}
		mutation.mutate({
			owned: true,
			entityIds: [props.entityId],
			ownedOn: ownedOn === "" ? null : ownedOn,
		});
	};
	return (
		<Dialog
			onClose={onClose}
			title="Mark as owned"
			initialFocusRef={dateRef}
			closeLabel="Close ownership"
			dismissible={!mutation.isPending}
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
							disabled={mutation.isPending}
							onChange={(event) => setOwnedOn(event.currentTarget.value)}
						/>
					)}
				</Field>
				{mutation.error === null ? null : (
					<StatusMessage tone="error">Unable to save ownership. Try again.</StatusMessage>
				)}
				<div className="flex gap-2">
					<Button type="button" onClick={save} disabled={invalid || mutation.isPending}>
						{mutation.isPending ? "Saving…" : "Save"}
					</Button>
					<Button type="button" onClick={onClose} variant="secondary" disabled={mutation.isPending}>
						Cancel
					</Button>
				</div>
			</ActionForm>
		</Dialog>
	);
}

export function MediaOwnershipRow(props: {
	readonly entityId: string;
	readonly owned: boolean | null;
	readonly ownedOn: string | null;
}) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const mutation = useRyotMutation(setOwnership);
	return (
		<>
			<Row
				title="Ownership"
				description={
					mutation.error === null ? (
						mediaOwnershipLabel(props.owned, props.ownedOn)
					) : (
						<span role="alert">Unable to change ownership. Try again.</span>
					)
				}
				trailing={
					<Switch
						disabled={mutation.isPending}
						checked={props.owned === true}
						label="Toggle media ownership"
						onChange={(owned) =>
							owned
								? setDialogOpen(true)
								: mutation.mutate({ owned: false, entityIds: [props.entityId] })
						}
					/>
				}
			/>
			{dialogOpen ? (
				<MediaOwnedOnDialog entityId={props.entityId} onClose={() => setDialogOpen(false)} />
			) : null}
		</>
	);
}
