import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button, FieldMessage } from "@ryot-app/plugin-ui-sdk";

const PRECONDITIONS = [
	kernelMessage("client.backups.confirm.precondition.empty"),
	kernelMessage("client.backups.confirm.precondition.plugins"),
	kernelMessage("client.backups.confirm.precondition.integrations"),
	kernelMessage("client.backups.confirm.precondition.irreversible"),
];

export function BackupRestoreConfirmStep(props: {
	readonly pending: boolean;
	readonly disabled: boolean;
	readonly onBack: () => void;
	readonly onRestore: () => void;
	readonly failureDetail: Message | undefined;
}) {
	const t = useT();
	return (
		<div className="flex flex-col gap-4">
			<p className="text-sm leading-6 text-text-muted">
				{t(kernelMessage("client.backups.confirm.intro"))}
			</p>
			<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
				{PRECONDITIONS.map((line) => (
					<div key={line.key} className="flex gap-2">
						<span className="text-xs text-text-subtle">·</span>
						<span className="min-w-0 flex-1 text-xs leading-5 text-text-muted">{t(line)}</span>
					</div>
				))}
			</div>
			{props.failureDetail === undefined ? null : (
				<FieldMessage>{t(props.failureDetail)}</FieldMessage>
			)}
			<div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
				<Button
					type="button"
					variant="primary"
					className="sm:px-6"
					onClick={props.onRestore}
					disabled={props.disabled || props.pending}
				>
					{t(
						props.pending
							? kernelMessage("common.status.starting")
							: kernelMessage("client.backups.confirm.restore"),
					)}
				</Button>
				<Button
					type="button"
					variant="secondary"
					className="sm:px-6"
					onClick={props.onBack}
					disabled={props.pending}
					aria-label={t(kernelMessage("client.backups.confirm.back-aria"))}
				>
					{t(kernelMessage("common.action.back"))}
				</Button>
			</div>
		</div>
	);
}
