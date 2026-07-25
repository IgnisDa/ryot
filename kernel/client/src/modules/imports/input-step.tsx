import { Button, FieldMessage } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import {
	SchemaForm,
	type SchemaFileUpload,
	type SchemaFormApi,
} from "@ryot-app/client-ui-sdk/schema-form";
import { useState } from "react";

import type { ImportWizardSource } from "#/modules/imports/source-selection";
import { schemaFormIcons } from "#/modules/ui/schema-form-icons";

const HELP_LABEL = "Where do I find this file?";

function ImportExportHelp(props: { readonly help: NonNullable<ImportWizardSource["exportHelp"]> }) {
	const [isOpen, setIsOpen] = useState(false);
	const docsUrl = props.help.docsUrl;
	return (
		<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
			<button
				type="button"
				aria-expanded={isOpen}
				aria-label={HELP_LABEL}
				onClick={() => setIsOpen(!isOpen)}
				className="flex items-center justify-between gap-2 text-left"
			>
				<span className="min-w-0 flex-1 text-sm font-medium text-text">{HELP_LABEL}</span>
				<AppIcon
					size={16}
					className="shrink-0 text-text-subtle"
					name={isOpen ? "chevron-up" : "chevron-down"}
				/>
			</button>
			{isOpen ? (
				<div className="flex flex-col gap-2">
					{(props.help.steps ?? []).map((step, index) => (
						<div key={step} className="flex gap-2">
							<span className="text-xs tabular-nums text-text-subtle">{`${index + 1}.`}</span>
							<span className="min-w-0 flex-1 text-xs leading-5 text-text-muted">{step}</span>
						</div>
					))}
					{docsUrl === undefined ? null : (
						<a
							href={docsUrl}
							target="_blank"
							rel="noreferrer"
							aria-label="Open the export guide"
							className="flex items-center gap-1.5 self-start py-1"
						>
							<span className="text-sm font-medium text-accent-text">Open the export guide</span>
							<AppIcon size={14} name="arrow-right" className="text-accent-text" />
						</a>
					)}
				</div>
			) : null}
		</div>
	);
}

export function ImportInputStep(props: {
	readonly onBack: () => void;
	readonly form: SchemaFormApi;
	readonly onContinue: () => void;
	readonly source: ImportWizardSource;
	readonly uploadFile: SchemaFileUpload;
	readonly failureDetail: string | undefined;
}) {
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h3 className="font-display text-lg font-semibold text-text">{props.source.name}</h3>
				<p className="text-sm leading-6 text-text-muted">{props.source.description}</p>
			</div>
			{props.source.exportHelp === undefined ? null : (
				<ImportExportHelp help={props.source.exportHelp} />
			)}
			<SchemaForm
				form={props.form}
				icons={schemaFormIcons}
				onChange={() => undefined}
				uploadFile={props.uploadFile}
				schema={props.source.inputSchema}
			/>
			{props.failureDetail === undefined ? null : (
				<FieldMessage>{props.failureDetail}</FieldMessage>
			)}
			<div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
				<Button type="button" variant="primary" onClick={props.onContinue} className="sm:px-6">
					Continue
				</Button>
				<Button type="button" variant="secondary" onClick={props.onBack} className="sm:px-6">
					Back
				</Button>
			</div>
		</div>
	);
}
