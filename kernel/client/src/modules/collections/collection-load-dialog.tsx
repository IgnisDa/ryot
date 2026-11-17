import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button, Dialog, Notice } from "@ryot-app/plugin-ui-sdk";

export function CollectionLoadDialog(props: {
	readonly title: Text;
	readonly failed: boolean;
	readonly missing: boolean;
	readonly closeLabel: Text;
	readonly onClose: () => void;
	readonly onRetry: () => void;
}) {
	const t = useT();
	return (
		<Dialog title={props.title} onClose={props.onClose} closeLabel={props.closeLabel}>
			{props.failed ? (
				<Notice
					tone="danger"
					action={
						<Button variant="secondary" onClick={props.onRetry}>
							{t(kernelMessage("common.action.retry"))}
						</Button>
					}
				>
					{t(kernelMessage("renderer.collection-detail.load-failed"))}
				</Notice>
			) : (
				<p role="status">
					{t(
						props.missing
							? kernelMessage("client.collections.load.missing")
							: kernelMessage("client.collections.load.loading"),
					)}
				</p>
			)}
		</Dialog>
	);
}
