import { Button, FieldMessage } from "@ryot-app/client-ui-sdk";
import type { SchemaFormValues } from "@ryot-app/client-ui-sdk/schema-form";

import {
	importSourceInputShape,
	type ImportWizardSource,
} from "#/modules/imports/source-selection";
import { schemaReviewRows } from "#/modules/ui/review-rows";

const UNDOABLE_NOTE =
	"Starting this adds these entries to your library. An import cannot be undone.";

export function ImportReviewStep(props: {
	readonly pending: boolean;
	readonly onBack: () => void;
	readonly onStart: () => void;
	readonly values: SchemaFormValues;
	readonly source: ImportWizardSource;
	readonly failureDetail: string | undefined;
}) {
	const rows = schemaReviewRows(props.source.inputSchema, props.values);
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
				<div className="flex items-center justify-between gap-3">
					<span className="min-w-0 flex-1 truncate text-base font-semibold text-text">
						{props.source.name}
					</span>
					<span className="rounded-full border border-border-strong px-2 py-0.5 text-[11px] font-medium text-text-muted">
						{importSourceInputShape(props.source.inputSchema)}
					</span>
				</div>
				{rows.length === 0 ? (
					<p className="text-sm text-text-muted">This service needs nothing else from you.</p>
				) : (
					<div className="flex flex-col gap-2">
						{rows.map((row) => (
							<div
								key={row.label}
								className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3"
							>
								<span className="text-xs text-text-subtle sm:w-40">{row.label}</span>
								<span className="min-w-0 flex-1 text-sm font-medium text-text">{row.value}</span>
							</div>
						))}
					</div>
				)}
			</div>
			<p className="text-sm leading-6 text-text-muted">{UNDOABLE_NOTE}</p>
			{props.failureDetail === undefined ? null : (
				<FieldMessage>{props.failureDetail}</FieldMessage>
			)}
			<div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
				<Button
					type="button"
					variant="primary"
					className="sm:px-6"
					onClick={props.onStart}
					disabled={props.pending}
				>
					{props.pending ? "Starting..." : "Start import"}
				</Button>
				<Button
					type="button"
					variant="secondary"
					className="sm:px-6"
					onClick={props.onBack}
					disabled={props.pending}
				>
					Back
				</Button>
			</div>
		</div>
	);
}
