import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button } from "@ryot-app/plugin-ui-sdk";

import { StatusState } from "#/modules/ui/status-state";

export function LoadErrorState(props: {
	readonly title: Text;
	readonly detail: Text;
	readonly onRetry: () => void;
}) {
	const t = useT();
	return (
		<StatusState
			detailTone="danger"
			title={props.title}
			detail={props.detail}
			className="rounded-xl border border-border bg-surface p-6"
			action={
				<Button type="button" variant="secondary" onClick={props.onRetry}>
					{t(kernelMessage("common.action.try-again"))}
				</Button>
			}
		/>
	);
}
