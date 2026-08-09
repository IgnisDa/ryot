import { useRouteContext } from "@tanstack/react-router";
import { Effect, Match } from "effect";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { BackupsApi } from "#/api/backups";
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

export function BackupRestoreWizard(props: {
	readonly disabled: boolean;
	readonly onClose: () => void;
	readonly onRestoreStarted: () => void;
}) {
	const { runtime, scope } = useRouteContext({ from: "/_authenticated" });
	const uploadFile = useSchemaFileUpload();
	const controller = useRef(new AbortController());
	const [pending, setPending] = useState(false);
	const [step, setStep] = useState<BackupRestoreStep>("choose");
	const [uploadToken, setUploadToken] = useState<string | undefined>();
	const [failure, setFailure] = useState<BackupRestoreFailure | undefined>();

	useEffect(() => () => controller.current.abort(), []);

	const startRestore = useEffectEvent(async () => {
		if (props.disabled || uploadToken === undefined) {
			return;
		}
		setPending(true);
		setFailure(undefined);
		const outcome = await runtime.runPromise(
			Effect.flatMap(BackupsApi, (api) =>
				api.createRestore(scope, { payload: { uploadToken } }),
			).pipe(
				Effect.match({
					onSuccess: () => ({ failure: undefined }),
					onFailure: (error) => ({ failure: backupRestoreFailure(error) }),
				}),
			),
			{ signal: controller.current.signal },
		);
		setPending(false);
		if (outcome.failure !== undefined) {
			setFailure(outcome.failure);
			if (outcome.failure.step !== undefined) {
				setStep(outcome.failure.step);
			}
			return;
		}
		props.onRestoreStarted();
		props.onClose();
	});

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
				pending={pending}
				disabled={props.disabled}
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
