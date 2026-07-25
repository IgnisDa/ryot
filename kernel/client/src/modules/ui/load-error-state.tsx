import { Button } from "@ryot-app/client-ui-sdk";

import { StatusState } from "#/modules/ui/status-state";

export function LoadErrorState(props: {
	readonly title: string;
	readonly detail: string;
	readonly onRetry: () => void;
}) {
	return (
		<StatusState
			detailTone="danger"
			title={props.title}
			detail={props.detail}
			className="rounded-xl border border-border bg-surface p-6"
			action={
				<Button type="button" variant="secondary" onClick={props.onRetry}>
					Try again
				</Button>
			}
		/>
	);
}
