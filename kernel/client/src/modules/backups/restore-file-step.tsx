import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button } from "@ryot-app/plugin-ui-sdk";
import {
	pickBrowserUploadFile,
	SchemaFileField,
	type SchemaFileUpload,
} from "@ryot-app/plugin-ui-sdk/schema-form";

import { schemaFormIcons } from "#/modules/ui/schema-form-icons";

export function BackupRestoreFileStep(props: {
	readonly onContinue: () => void;
	readonly uploadFile: SchemaFileUpload;
	readonly uploadToken: string | undefined;
	readonly onTokenChange: (token: string | undefined) => void;
}) {
	const t = useT();
	return (
		<div className="flex flex-col gap-4">
			<p className="text-sm leading-6 text-text-muted">
				{t(kernelMessage("client.backups.file.intro"))}
			</p>
			<SchemaFileField
				icons={schemaFormIcons}
				value={props.uploadToken}
				uploadFile={props.uploadFile}
				onChange={props.onTokenChange}
				allowedFileExtensions={["zip"]}
				pickFile={pickBrowserUploadFile}
				label={t(kernelMessage("client.backups.file.label"))}
				readyLabel={t(kernelMessage("client.backups.file.ready"))}
			/>
			<div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
				<Button
					type="button"
					variant="primary"
					className="sm:px-6"
					onClick={props.onContinue}
					disabled={props.uploadToken === undefined}
					aria-label={t(kernelMessage("client.backups.file.continue-aria"))}
				>
					{t(kernelMessage("common.action.continue"))}
				</Button>
			</div>
		</div>
	);
}
