import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { SchemaFileField, type SchemaFileIcons } from "./field";
import type {
	SchemaFileCandidate,
	SchemaFilePicker,
	SchemaFileUpload,
	SchemaFileUploadOutcome,
} from "./upload";

const icons: SchemaFileIcons = { file: "file", remove: "remove", upload: "upload" };

const candidate = (name: string, size: number): SchemaFileCandidate => ({
	name,
	size,
	contentType: "application/zip",
	source: new Blob([new Uint8Array([1, 2, 3])]),
});

const pickingFile =
	(file: SchemaFileCandidate): SchemaFilePicker =>
	() =>
		Promise.resolve({ file, kind: "picked" });

const deferredUpload = () => {
	const requests: { readonly fileName: string }[] = [];
	const settlers: ((outcome: SchemaFileUploadOutcome) => void)[] = [];
	const uploadFile: SchemaFileUpload = (request) => {
		requests.push({ fileName: request.fileName });
		return new Promise((resolve) => {
			settlers.push(resolve);
		});
	};
	return {
		requests,
		uploadFile,
		resolve: (index: number, outcome: SchemaFileUploadOutcome) => settlers[index]?.(outcome),
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
			icons={icons}
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

describe("SchemaFileField", () => {
	it("uploads a chosen file and reports the token once the upload completes", async () => {
		const upload = deferredUpload();
		const tokens: (string | undefined)[] = [];
		render(
			<FileFieldHarness
				uploadFile={upload.uploadFile}
				onChange={(token) => tokens.push(token)}
				pickFile={pickingFile(candidate("trakt.zip", 2048))}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Choose a file for Archive" }));

		const element = await screen.findByLabelText("Uploading Archive");
		expect(element.getAttribute("aria-busy")).toBe("true");
		expect(screen.getByText("trakt.zip")).toBeTruthy();
		expect(screen.getByText("Uploading · 2.0 KB")).toBeTruthy();
		expect(upload.requests).toEqual([{ fileName: "trakt.zip" }]);

		upload.resolve(0, { kind: "uploaded", token: "token-1" });

		expect(await screen.findByText("2.0 KB · Ready to import")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Remove Archive file" })).toBeTruthy();
		expect(tokens).toEqual([undefined, "token-1"]);
	});

	it("clears the value and explains a failed upload", async () => {
		const tokens: (string | undefined)[] = [];
		const upload = deferredUpload();
		render(
			<FileFieldHarness
				uploadFile={upload.uploadFile}
				onChange={(token) => tokens.push(token)}
				pickFile={pickingFile(candidate("trakt.zip", 2048))}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Choose a file for Archive" }));
		await screen.findByLabelText("Uploading Archive");
		upload.resolve(0, { kind: "failed", message: "Could not upload this file. Try again." });

		const element = await screen.findByRole("alert");
		expect(element.textContent).toContain("Could not upload this file. Try again.");
		expect(screen.getByRole("button", { name: "Choose a file for Archive" })).toBeTruthy();
		expect(tokens).toEqual([undefined, undefined]);
	});

	it("rejects a wrong extension before uploading anything", async () => {
		const upload = deferredUpload();
		render(
			<FileFieldHarness
				onChange={() => undefined}
				uploadFile={upload.uploadFile}
				pickFile={pickingFile(candidate("history.csv", 512))}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Choose a file for Archive" }));

		const element = await screen.findByRole("alert");
		expect(element.textContent).toContain("Choose a .zip file.");
		expect(upload.requests).toEqual([]);
	});

	it("ignores a stale attempt's completion after a replacement selection", async () => {
		const tokens: (string | undefined)[] = [];
		const upload = deferredUpload();
		const files = [candidate("first.zip", 1024), candidate("second.zip", 2048)];
		render(
			<FileFieldHarness
				onChange={(token) => tokens.push(token)}
				uploadFile={upload.uploadFile}
				pickFile={() => {
					const file = files.shift();
					return Promise.resolve(
						file === undefined ? { kind: "canceled" } : { kind: "picked", file },
					);
				}}
			/>,
		);

		const choose = screen.getByRole("button", { name: "Choose a file for Archive" });
		fireEvent.click(choose);
		await screen.findByText("first.zip");
		fireEvent.click(screen.getByRole("button", { name: "Remove Archive file" }));
		fireEvent.click(screen.getByRole("button", { name: "Choose a file for Archive" }));
		await screen.findByText("second.zip");

		upload.resolve(0, { kind: "uploaded", token: "stale-token" });
		upload.resolve(1, { kind: "uploaded", token: "current-token" });

		expect(await screen.findByText("2.0 KB · Ready to import")).toBeTruthy();
		expect(screen.getByText("second.zip")).toBeTruthy();
		expect(tokens).toEqual([undefined, undefined, undefined, "current-token"]);
	});
});
