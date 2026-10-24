import type {
	ManageRemindersOutcome,
	ManageRemindersRequest,
} from "@ryot-app/plugin-client-contract";
import { Dialog } from "@ryot-app/plugin-ui-sdk";
import { useRef } from "react";

import { useHostScreenSession } from "#/modules/ui/host-screen-session";

import { ReminderManager } from "./manager";

export function useReminderScreen() {
	const host = useHostScreenSession<ManageRemindersRequest, ManageRemindersOutcome>({
		kind: "cancelled",
	});
	const session = host.session;
	return {
		open: session !== null,
		onManageReminders: host.open,
		screen:
			session === null ? null : (
				<ReminderScreen request={session.request} complete={session.complete} />
			),
	};
}

function ReminderScreen(props: {
	readonly request: ManageRemindersRequest;
	readonly complete: (outcome: ManageRemindersOutcome) => void;
}) {
	const changed = useRef(false);
	return (
		<Dialog
			title="Reminders"
			closeLabel="Close reminders"
			onClose={() => props.complete({ kind: changed.current ? "changed" : "cancelled" })}
		>
			<ReminderManager
				entityId={props.request.entityId}
				parentEntityId={props.request.parentEntityId}
				onChanged={() => {
					changed.current = true;
				}}
			/>
		</Dialog>
	);
}
