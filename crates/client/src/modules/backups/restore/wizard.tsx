import { useAtomSet } from "@effect/atom-react";
import { Exit, Match } from "effect";
import { useEffectEvent, useState } from "react";

import { temporaryFileUploadOperation } from "@/api/files/upload";
import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { pickUploadFile } from "@/modules/ui/schema-form/file/pick-upload-file";
import { WizardShell } from "@/modules/ui/wizard/wizard-shell";
import { wizardStepLabel } from "@/modules/ui/wizard/wizard-state";

import { createBackupRestoreAtom, backupRunReactivityKeys } from "../atoms";
import { BackupRestoreConfirmStep } from "./confirm-step";
import {
	BACKUP_RESTORE_STEPS,
	type BackupRestoreFailure,
	type BackupRestoreStep,
	backupRestoreFailure,
} from "./failure";
import { BackupRestoreFileStep } from "./file-step";

export const BACKUP_RESTORE_WIZARD_TITLE = "Restore from a backup";

const stepHeadings = {
	confirm: "Confirm the restore",
	choose: "Choose your backup file",
} as const satisfies Record<BackupRestoreStep, string>;

export function BackupRestoreWizard(props: {
	readonly disabled: boolean;
	readonly onClose: () => void;
	readonly onRestoreStarted: () => void;
}) {
	const scope = useApiScope();
	const createRestore = useAtomSet(createBackupRestoreAtom(scope), { mode: "promiseExit" });
	const [pending, setPending] = useState(false);
	const [restoreCause, setRestoreCause] = useState<unknown>();
	const [step, setStep] = useState<BackupRestoreStep>("choose");
	const [uploadToken, setUploadToken] = useState<string | undefined>();
	const [failure, setFailure] = useState<BackupRestoreFailure | undefined>();
	const uploadFile = temporaryFileUploadOperation(scope);

	useInternalRequestFailureLogging("backup restore creation failed", restoreCause);

	const startRestore = useEffectEvent(async () => {
		if (props.disabled || uploadToken === undefined) {
			return;
		}
		setPending(true);
		setFailure(undefined);
		setRestoreCause(undefined);
		const exit = await createRestore({
			payload: { uploadToken },
			reactivityKeys: backupRunReactivityKeys(scope),
		});
		setPending(false);
		if (Exit.isFailure(exit)) {
			const mapped = backupRestoreFailure(exit.cause);
			setRestoreCause(exit.cause);
			setFailure(mapped);
			if (mapped.step !== undefined) {
				setStep(mapped.step);
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
				pickFile={pickUploadFile}
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
			onClose={props.onClose}
			title={BACKUP_RESTORE_WIZARD_TITLE}
			closeLabel="Close the restore wizard"
			stepLabel={wizardStepLabel(step, BACKUP_RESTORE_STEPS, stepHeadings)}
		>
			{stepBody}
		</WizardShell>
	);
}
