import { describe, expect, it } from "@effect/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Effect } from "effect";
import { useState } from "react";

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
		// oxlint-disable-next-line effecttsgo/new-promise -- Test gate controls upload completion.
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
	it.live("uploads a chosen file and reports the token once the upload completes", () =>
		Effect.gen(function* () {
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

			const element = yield* Effect.promise(() => screen.findByLabelText("Uploading Archive"));
			expect(element.getAttribute("aria-busy")).toBe("true");
			expect(screen.getByText("trakt.zip")).toBeTruthy();
			expect(screen.getByText("Uploading · 2.0 KB")).toBeTruthy();
			expect(upload.requests).toEqual([{ fileName: "trakt.zip" }]);

			upload.resolve(0, { kind: "uploaded", token: "token-1" });

			expect(
				yield* Effect.promise(() => screen.findByText("2.0 KB · Ready to import")),
			).toBeTruthy();
			expect(screen.getByRole("button", { name: "Remove Archive file" })).toBeTruthy();
			expect(tokens).toEqual([undefined, "token-1"]);
		}),
	);

	it.live("clears the value and explains a failed upload", () =>
		Effect.gen(function* () {
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
			yield* Effect.promise(() => screen.findByLabelText("Uploading Archive"));
			upload.resolve(0, { kind: "failed", message: "Could not upload this file. Try again." });

			const element = yield* Effect.promise(() => screen.findByRole("alert"));
			expect(element.textContent).toContain("Could not upload this file. Try again.");
			expect(screen.getByRole("button", { name: "Choose a file for Archive" })).toBeTruthy();
			expect(tokens).toEqual([undefined, undefined]);
		}),
	);

	it.live("rejects a wrong extension before uploading anything", () =>
		Effect.gen(function* () {
			const upload = deferredUpload();
			render(
				<FileFieldHarness
					onChange={() => undefined}
					uploadFile={upload.uploadFile}
					pickFile={pickingFile(candidate("history.csv", 512))}
				/>,
			);

			fireEvent.click(screen.getByRole("button", { name: "Choose a file for Archive" }));

			const element = yield* Effect.promise(() => screen.findByRole("alert"));
			expect(element.textContent).toContain("Choose a .zip file.");
			expect(upload.requests).toEqual([]);
		}),
	);

	it.live("clears the value when the uploaded file is removed", () =>
		Effect.gen(function* () {
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
			yield* Effect.promise(() => screen.findByLabelText("Uploading Archive"));
			upload.resolve(0, { kind: "uploaded", token: "token-1" });
			yield* Effect.promise(() => screen.findByText("2.0 KB · Ready to import"));
			fireEvent.click(screen.getByRole("button", { name: "Remove Archive file" }));

			expect(screen.getByRole("button", { name: "Choose a file for Archive" })).toBeTruthy();
			expect(tokens).toEqual([undefined, "token-1", undefined]);
		}),
	);

	it.live("ignores a stale attempt's completion after a replacement selection", () =>
		Effect.gen(function* () {
			const tokens: (string | undefined)[] = [];
			const upload = deferredUpload();
			const files = [candidate("first.zip", 1024), candidate("second.zip", 2048)];
			render(
				<FileFieldHarness
					uploadFile={upload.uploadFile}
					onChange={(token) => tokens.push(token)}
					pickFile={() => {
						const file = files.shift();
						return Promise.resolve(
							file === undefined ? { kind: "canceled" } : { file, kind: "picked" },
						);
					}}
				/>,
			);

			const choose = screen.getByRole("button", { name: "Choose a file for Archive" });
			fireEvent.click(choose);
			yield* Effect.promise(() => screen.findByText("first.zip"));
			fireEvent.click(screen.getByRole("button", { name: "Remove Archive file" }));
			fireEvent.click(screen.getByRole("button", { name: "Choose a file for Archive" }));
			yield* Effect.promise(() => screen.findByText("second.zip"));

			upload.resolve(0, { kind: "uploaded", token: "stale-token" });
			upload.resolve(1, { kind: "uploaded", token: "current-token" });

			expect(
				yield* Effect.promise(() => screen.findByText("2.0 KB · Ready to import")),
			).toBeTruthy();
			expect(screen.getByText("second.zip")).toBeTruthy();
			expect(tokens).toEqual([undefined, undefined, undefined, "current-token"]);
		}),
	);

	it.live("lets only the latest overlapping picker result start an upload", () =>
		Effect.gen(function* () {
			const picks: ((outcome: Awaited<ReturnType<SchemaFilePicker>>) => void)[] = [];
			const uploaded: string[] = [];
			const pickFile: SchemaFilePicker = () => {
				// oxlint-disable-next-line effecttsgo/new-promise -- Test gate controls the browser picker response.
				return new Promise((resolve) => picks.push(resolve));
			};
			render(
				<FileFieldHarness
					pickFile={pickFile}
					onChange={() => undefined}
					uploadFile={(request) => {
						uploaded.push(request.fileName);
						return Promise.resolve({ kind: "uploaded", token: request.fileName });
					}}
				/>,
			);

			const choose = screen.getByRole("button", { name: "Choose a file for Archive" });
			fireEvent.click(choose);
			fireEvent.click(choose);
			picks[0]?.({ kind: "picked", file: candidate("stale.zip", 100) });
			picks[1]?.({ kind: "picked", file: candidate("latest.zip", 200) });

			expect(yield* Effect.promise(() => screen.findByText("latest.zip"))).toBeTruthy();
			expect(uploaded).toEqual(["latest.zip"]);
		}),
	);

	it.live("does not publish upload completion after unmount", () =>
		Effect.gen(function* () {
			const tokens: (string | undefined)[] = [];
			const upload = deferredUpload();
			const rendered = render(
				<FileFieldHarness
					uploadFile={upload.uploadFile}
					onChange={(token) => tokens.push(token)}
					pickFile={pickingFile(candidate("trakt.zip", 2048))}
				/>,
			);

			fireEvent.click(screen.getByRole("button", { name: "Choose a file for Archive" }));
			yield* Effect.promise(() => screen.findByLabelText("Uploading Archive"));
			rendered.unmount();
			upload.resolve(0, { kind: "uploaded", token: "late-token" });
			yield* Effect.promise(() => Promise.resolve());

			expect(tokens).toEqual([undefined]);
		}),
	);
});
