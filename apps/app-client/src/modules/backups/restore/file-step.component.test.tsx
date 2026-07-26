import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { useState } from "react";

import type {
	SchemaFileCandidate,
	SchemaFilePicker,
	SchemaFileUpload,
} from "@/modules/ui/schema-form/file/file-upload";

import { BackupRestoreFileStep } from "./file-step";

const candidate = (name: string): SchemaFileCandidate => ({
	name,
	size: 2048,
	contentType: "application/zip",
	source: new Blob([new Uint8Array([1, 2, 3])]),
});

const pickNothing: SchemaFilePicker = () => Promise.resolve({ kind: "canceled" });

const uploadNothing: SchemaFileUpload = () =>
	Promise.resolve({ kind: "uploaded", token: "upload-token" });

function FileStepHarness(props: {
	readonly onContinue?: () => void;
	readonly pickFile?: SchemaFilePicker;
	readonly uploadFile?: SchemaFileUpload;
	readonly onTokenChange?: (token: string | undefined) => void;
}) {
	const [token, setToken] = useState<string | undefined>(undefined);
	return (
		<BackupRestoreFileStep
			uploadToken={token}
			pickFile={props.pickFile ?? pickNothing}
			uploadFile={props.uploadFile ?? uploadNothing}
			onContinue={props.onContinue ?? (() => undefined)}
			onTokenChange={(next) => {
				setToken(next);
				props.onTokenChange?.(next);
			}}
		/>
	);
}

describe("backup restore file step", () => {
	it("holds the wizard until an archive has been uploaded", async () => {
		const user = userEvent.setup();
		const continues: number[] = [];
		await render(<FileStepHarness onContinue={() => continues.push(1)} />);
		const button = screen.getByRole("button", { name: "Continue to confirm the restore" });

		expect(button).toBeDisabled();

		await user.press(button);

		expect(continues).toEqual([]);
	});

	it("accepts a zip archive and carries its upload token to the next step", async () => {
		const user = userEvent.setup();
		const continues: number[] = [];
		const uploadedNames: string[] = [];
		const tokens: (string | undefined)[] = [];
		const requestedExtensions: string[][] = [];
		await render(
			<FileStepHarness
				onContinue={() => continues.push(1)}
				onTokenChange={(token) => tokens.push(token)}
				pickFile={(options) => {
					requestedExtensions.push([...options.allowedFileExtensions]);
					return Promise.resolve({ kind: "picked", file: candidate("ryot-backup.zip") });
				}}
				uploadFile={(request) => {
					uploadedNames.push(request.fileName);
					return Promise.resolve({ kind: "uploaded", token: "upload-token" });
				}}
			/>,
		);

		await user.press(screen.getByRole("button", { name: "Choose a file for Backup archive" }));

		expect(await screen.findByText("2.0 KB · Ready to restore")).toBeOnTheScreen();
		expect(screen.queryByText(/Ready to import/)).not.toBeOnTheScreen();
		expect(requestedExtensions).toEqual([["zip"]]);
		expect(uploadedNames).toEqual(["ryot-backup.zip"]);
		expect(tokens).toEqual([undefined, "upload-token"]);

		await user.press(screen.getByRole("button", { name: "Continue to confirm the restore" }));

		expect(continues).toEqual([1]);
	});

	it("turns away a file that is not a zip archive without uploading it", async () => {
		const user = userEvent.setup();
		const tokens: (string | undefined)[] = [];
		const uploads: number[] = [];
		await render(
			<FileStepHarness
				onTokenChange={(token) => tokens.push(token)}
				pickFile={() => Promise.resolve({ kind: "picked", file: candidate("ryot-backup.tar") })}
				uploadFile={() => {
					uploads.push(1);
					return Promise.resolve({ kind: "uploaded", token: "upload-token" });
				}}
			/>,
		);

		await user.press(screen.getByRole("button", { name: "Choose a file for Backup archive" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("Choose a .zip file.");
		expect(uploads).toEqual([]);
		expect(tokens).toEqual([undefined]);
		expect(screen.getByRole("button", { name: "Continue to confirm the restore" })).toBeDisabled();
	});
});
