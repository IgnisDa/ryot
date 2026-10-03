import { Button } from "@ryot-app/client-ui-sdk";
import {
	pickBrowserUploadFile,
	SchemaFileField,
	type SchemaFileUpload,
} from "@ryot-app/client-ui-sdk/schema-form";

import { schemaFormIcons } from "#/modules/ui/schema-form-icons";

const INTRO =
	"Choose the zip archive Ryot exported. It is uploaded to your own server and read once.";

export function BackupRestoreFileStep(props: {
	readonly onContinue: () => void;
	readonly uploadFile: SchemaFileUpload;
	readonly uploadToken: string | undefined;
	readonly onTokenChange: (token: string | undefined) => void;
}) {
	return (
		<div className="flex flex-col gap-4">
			<p className="text-sm leading-6 text-text-muted">{INTRO}</p>
			<SchemaFileField
				label="Backup archive"
				icons={schemaFormIcons}
				value={props.uploadToken}
				uploadFile={props.uploadFile}
				readyLabel="Ready to restore"
				onChange={props.onTokenChange}
				allowedFileExtensions={["zip"]}
				pickFile={pickBrowserUploadFile}
			/>
			<div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
				<Button
					type="button"
					variant="primary"
					className="sm:px-6"
					onClick={props.onContinue}
					disabled={props.uploadToken === undefined}
					aria-label="Continue to confirm the restore"
				>
					Continue
				</Button>
			</div>
		</div>
	);
}
