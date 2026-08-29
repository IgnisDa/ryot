import { Button, FieldMessage } from "@ryot-app/client-ui-sdk";

const PRECONDITIONS = [
	"This account must be new and empty. If it already holds anything, the restore stops without changing it.",
	"The same plugins and providers this backup was made with must be available on this server.",
	"Integrations and notification channels are not restored. You set those up again yourself.",
	"This cannot be undone, and it cannot be repeated without resetting the account first.",
];

export function BackupRestoreConfirmStep(props: {
	readonly pending: boolean;
	readonly disabled: boolean;
	readonly onBack: () => void;
	readonly onRestore: () => void;
	readonly failureDetail: string | undefined;
}) {
	return (
		<div className="flex flex-col gap-4">
			<p className="text-sm leading-6 text-text-muted">Before this starts, check each of these.</p>
			<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
				{PRECONDITIONS.map((line) => (
					<div key={line} className="flex gap-2">
						<span className="text-xs text-text-subtle">·</span>
						<span className="min-w-0 flex-1 text-xs leading-5 text-text-muted">{line}</span>
					</div>
				))}
			</div>
			{props.failureDetail === undefined ? null : (
				<FieldMessage>{props.failureDetail}</FieldMessage>
			)}
			<div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
				<Button
					type="button"
					variant="primary"
					className="sm:px-6"
					onClick={props.onRestore}
					disabled={props.disabled || props.pending}
				>
					{props.pending ? "Starting..." : "Restore this backup"}
				</Button>
				<Button
					type="button"
					variant="secondary"
					className="sm:px-6"
					onClick={props.onBack}
					disabled={props.pending}
					aria-label="Back to choosing a file"
				>
					Back
				</Button>
			</div>
		</div>
	);
}
