import { Button, Dialog, Notice } from "@ryot-app/plugin-ui-sdk";

export function CollectionLoadDialog(props: {
	readonly title: string;
	readonly closeLabel: string;
	readonly failed: boolean;
	readonly missing: boolean;
	readonly onClose: () => void;
	readonly onRetry: () => void;
}) {
	return (
		<Dialog title={props.title} onClose={props.onClose} closeLabel={props.closeLabel}>
			{props.failed ? (
				<Notice
					tone="danger"
					action={
						<Button variant="secondary" onClick={props.onRetry}>
							Retry collection
						</Button>
					}
				>
					The collection could not be loaded.
				</Notice>
			) : (
				<p role="status">
					{props.missing ? "This collection no longer exists." : "Loading collection…"}
				</p>
			)}
		</Dialog>
	);
}
