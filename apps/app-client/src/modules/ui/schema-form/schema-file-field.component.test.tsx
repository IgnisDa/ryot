import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { useState } from "react";

import type {
	SchemaFileCandidate,
	SchemaFilePicker,
	SchemaFileUpload,
	SchemaFileUploadOutcome,
} from "./file-upload";
import { SchemaFileField } from "./schema-file-field";

const candidate = (name: string, size: number): SchemaFileCandidate => ({
	name,
	size,
	contentType: "application/zip",
	readBytes: () => Promise.resolve(new Uint8Array([1, 2, 3])),
});

const pickingFile =
	(file: SchemaFileCandidate): SchemaFilePicker =>
	() =>
		Promise.resolve({ file, kind: "picked" });

const deferredUpload = () => {
	const requests: { readonly fileName: string }[] = [];
	let settle: ((outcome: SchemaFileUploadOutcome) => void) | undefined;
	const uploadFile: SchemaFileUpload = (request) => {
		requests.push({ fileName: request.fileName });
		return new Promise((resolve) => {
			settle = resolve;
		});
	};
	return {
		requests,
		uploadFile,
		resolve: (outcome: SchemaFileUploadOutcome) => settle?.(outcome),
	};
};

function FileFieldHarness(props: {
	readonly pickFile: SchemaFilePicker;
	readonly uploadFile: SchemaFileUpload;
	readonly onChange: (token: string | undefined) => void;
}) {
	const [value, setValue] = useState<string | undefined>(undefined);
	return (
		<SchemaFileField
			value={value}
			label="Archive"
			pickFile={props.pickFile}
			uploadFile={props.uploadFile}
			allowedFileExtensions={["zip"]}
			onChange={(token) => {
				setValue(token);
				props.onChange(token);
			}}
		/>
	);
}

describe("schema file field", () => {
	it("offers an empty drop target that names the accepted extensions", async () => {
		const upload = deferredUpload();
		await render(
			<FileFieldHarness
				uploadFile={upload.uploadFile}
				onChange={() => undefined}
				pickFile={() => Promise.resolve({ kind: "canceled" })}
			/>,
		);

		expect(screen.getByRole("button", { name: "Choose a file for Archive" })).toBeOnTheScreen();
		expect(screen.getByText("Accepts .zip")).toBeOnTheScreen();
		expect(upload.requests).toEqual([]);
	});

	it("uploads a chosen file and reports the token once the upload completes", async () => {
		const user = userEvent.setup();
		const tokens: (string | undefined)[] = [];
		const upload = deferredUpload();
		await render(
			<FileFieldHarness
				uploadFile={upload.uploadFile}
				onChange={(token) => tokens.push(token)}
				pickFile={pickingFile(candidate("trakt.zip", 2048))}
			/>,
		);

		await user.press(screen.getByRole("button", { name: "Choose a file for Archive" }));

		expect(await screen.findByLabelText("Uploading Archive")).toBeBusy();
		expect(screen.getByText("trakt.zip")).toBeOnTheScreen();
		expect(screen.getByText("Uploading · 2.0 KB")).toBeOnTheScreen();
		expect(upload.requests).toEqual([{ fileName: "trakt.zip" }]);

		upload.resolve({ kind: "uploaded", token: "token-1" });

		expect(await screen.findByRole("button", { name: "Remove Archive file" })).toBeOnTheScreen();
		expect(screen.getByText("2.0 KB · Ready to import")).toBeOnTheScreen();
		expect(tokens).toEqual([undefined, "token-1"]);
	});

	it("clears the value and explains a failed upload", async () => {
		const user = userEvent.setup();
		const tokens: (string | undefined)[] = [];
		const upload = deferredUpload();
		await render(
			<FileFieldHarness
				uploadFile={upload.uploadFile}
				onChange={(token) => tokens.push(token)}
				pickFile={pickingFile(candidate("trakt.zip", 2048))}
			/>,
		);

		await user.press(screen.getByRole("button", { name: "Choose a file for Archive" }));
		upload.resolve({ kind: "failed", message: "Could not upload this file. Try again." });

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Could not upload this file. Try again.",
		);
		expect(screen.getByRole("button", { name: "Choose a file for Archive" })).toBeOnTheScreen();
		expect(tokens).toEqual([undefined, undefined]);
	});

	it("rejects a wrong extension before uploading anything", async () => {
		const user = userEvent.setup();
		const upload = deferredUpload();
		await render(
			<FileFieldHarness
				uploadFile={upload.uploadFile}
				onChange={() => undefined}
				pickFile={pickingFile(candidate("history.csv", 512))}
			/>,
		);

		await user.press(screen.getByRole("button", { name: "Choose a file for Archive" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("Choose a .zip file.");
		expect(upload.requests).toEqual([]);
	});

	it("clears the value when the uploaded file is removed", async () => {
		const user = userEvent.setup();
		const tokens: (string | undefined)[] = [];
		const upload = deferredUpload();
		await render(
			<FileFieldHarness
				uploadFile={upload.uploadFile}
				onChange={(token) => tokens.push(token)}
				pickFile={pickingFile(candidate("trakt.zip", 2048))}
			/>,
		);

		await user.press(screen.getByRole("button", { name: "Choose a file for Archive" }));
		upload.resolve({ kind: "uploaded", token: "token-1" });
		await user.press(await screen.findByRole("button", { name: "Remove Archive file" }));

		expect(screen.getByRole("button", { name: "Choose a file for Archive" })).toBeOnTheScreen();
		expect(tokens).toEqual([undefined, "token-1", undefined]);
	});
});
