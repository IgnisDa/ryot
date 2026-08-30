import { createRyotMutation, useRyotMutation } from "@ryot-app/client-sdk/react";
import type { BackupRunIdResponse } from "@ryot-app/contract/modules/backups/schemas";
import { Effect, Match } from "effect";
import { useState } from "react";

import type { AuthenticatedApiError } from "#/api/authenticated";
import { BackupsApi } from "#/api/backups";
import type { KernelHostServices } from "#/host-services";
import { BackupRestoreConfirmStep } from "#/modules/backups/restore-confirm-step";
import {
	BACKUP_RESTORE_STEPS,
	backupRestoreFailure,
	type BackupRestoreFailure,
	type BackupRestoreStep,
} from "#/modules/backups/restore-failure";
import { BackupRestoreFileStep } from "#/modules/backups/restore-file-step";
import { useSchemaFileUpload } from "#/modules/ui/schema-form-upload";
import { WizardShell } from "#/modules/ui/wizard/wizard-shell";
import { wizardStepLabel } from "#/modules/ui/wizard/wizard-state";

const WIZARD_TITLE = "Restore from a backup";

const stepHeadings = {
	confirm: "Confirm the restore",
	choose: "Choose your backup file",
} as const satisfies Record<BackupRestoreStep, string>;

const createRestoreMutation = createRyotMutation<
	string,
	BackupRunIdResponse,
	KernelHostServices,
	AuthenticatedApiError
>(({ input, client, hostServices }) =>
	hostServices.runtime
		.runSync(BackupsApi)
		.createRestore(hostServices.scope, { payload: { uploadToken: input } })
		.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
);

export function BackupRestoreWizard(props: {
	readonly disabled: boolean;
	readonly onClose: () => void;
}) {
	const uploadFile = useSchemaFileUpload();
	const mutation = useRyotMutation(createRestoreMutation);
	const [step, setStep] = useState<BackupRestoreStep>("choose");
	const [uploadToken, setUploadToken] = useState<string | undefined>();
	const [failure, setFailure] = useState<BackupRestoreFailure | undefined>();

	const startRestore = () => {
		if (props.disabled || uploadToken === undefined) {
			return Promise.resolve();
		}
		setFailure(undefined);
		return mutation
			.mutateAsync(uploadToken)
			.then(() => true)
			.catch((error: unknown) => {
				const nextFailure = backupRestoreFailure(error);
				setFailure(nextFailure);
				if (nextFailure.step !== undefined) {
					setStep(nextFailure.step);
				}
				return false;
			})
			.then((restored) => {
				if (restored) {
					props.onClose();
				}
				return undefined;
			});
	};

	const changeToken = (token: string | undefined) => {
		setFailure(undefined);
		setUploadToken(token);
	};

	const goBack = () => {
		setFailure(undefined);
		setStep("choose");
	};

	const stepBody = Match.value(step).pipe(
		Match.when("choose", () => (
			<BackupRestoreFileStep
				uploadFile={uploadFile}
				uploadToken={uploadToken}
				onTokenChange={changeToken}
				onContinue={() => setStep("confirm")}
			/>
		)),
		Match.when("confirm", () => (
			<BackupRestoreConfirmStep
				onBack={goBack}
				disabled={props.disabled}
				pending={mutation.isPending}
				failureDetail={failure?.detail}
				onRestore={() => void startRestore()}
			/>
		)),
		Match.exhaustive,
	);

	return (
		<WizardShell
			title={WIZARD_TITLE}
			onClose={props.onClose}
			closeLabel="Close the restore wizard"
			stepLabel={wizardStepLabel(step, BACKUP_RESTORE_STEPS, stepHeadings)}
		>
			{stepBody}
		</WizardShell>
	);
}
