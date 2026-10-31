import { describe, expect, it } from "@effect/vitest";
import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Effect } from "effect";
import { act, useState } from "react";

import type { SchemaFilePickOutcome } from "../file/upload";
import { SchemaAssetField } from "./field";
import type { SchemaAssetUpload, SchemaAssetUploadOutcome } from "./upload";

const icons = { file: "file", remove: "remove", upload: "upload" };

const picked: SchemaFilePickOutcome = {
	kind: "picked",
	file: {
		size: 3,
		name: "photo.png",
		contentType: "image/png",
		source: new Blob(["abc"], { type: "image/png" }),
	},
};

function Harness(props: {
	readonly replace?: boolean;
	readonly upload: SchemaAssetUpload;
	readonly pick: SchemaFilePickOutcome;
	readonly onChange: (value: readonly AssetLocator[]) => void;
}) {
	const [value, setValue] = useState<readonly AssetLocator[]>([
		{ type: "local", key: "images/a.png" },
	]);
	return (
		<SchemaAssetField
			icons={icons}
			value={value}
			{...(props.replace === undefined ? {} : { replace: props.replace })}
			label="Images"
			uploadAsset={props.upload}
			pickFile={() => Promise.resolve(props.pick)}
			onChange={(next) => {
				setValue(next);
				props.onChange(next);
			}}
			renderAsset={(asset) => <span>{asset.type === "local" ? asset.key : "remote"}</span>}
		/>
	);
}

describe("SchemaAssetField", () => {
	it.live("replaces a standalone asset rather than appending another one", () =>
		Effect.gen(function* () {
			const changes: Array<readonly AssetLocator[]> = [];
			render(
				<Harness
					replace
					pick={picked}
					onChange={(next) => changes.push(next)}
					upload={() =>
						Promise.resolve({ kind: "uploaded", asset: { type: "local", key: "replacement.png" } })
					}
				/>,
			);
			fireEvent.click(screen.getByRole("button", { name: "Replace Images" }));
			yield* Effect.promise(() => screen.findByText("replacement.png"));
			expect(changes).toEqual([[{ type: "local", key: "replacement.png" }]]);
			expect(screen.queryByText("images/a.png")).toBeNull();
		}),
	);
	it.live("does not restore removed values when a pending upload completes", () =>
		Effect.gen(function* () {
			const context = yield* Effect.context();
			const pending = Promise.withResolvers<SchemaAssetUploadOutcome>();
			const changes: Array<readonly AssetLocator[]> = [];
			render(
				<Harness
					pick={picked}
					upload={() => pending.promise}
					onChange={(next) => changes.push(next)}
				/>,
			);
			fireEvent.click(screen.getByRole("button", { name: "Add Images" }));
			yield* Effect.promise(() => screen.findByRole("status", { name: "Uploading Images" }));
			fireEvent.click(screen.getByRole("button", { name: "Remove Images 1" }));
			yield* Effect.promise(() =>
				act(() => {
					pending.resolve({ kind: "uploaded", asset: { type: "local", key: "late.png" } });
					return Effect.runPromiseWith(context)(
						Effect.promise(() => pending.promise).pipe(Effect.asVoid),
					);
				}),
			);
			expect(changes).toEqual([[]]);
			expect(screen.queryByText("late.png")).toBeNull();
		}),
	);

	it.live("ignores an upload that completes after its control unmounts", () =>
		Effect.gen(function* () {
			const context = yield* Effect.context();
			const pending = Promise.withResolvers<SchemaAssetUploadOutcome>();
			const changes: Array<readonly AssetLocator[]> = [];
			const { unmount } = render(
				<Harness
					pick={picked}
					upload={() => pending.promise}
					onChange={(next) => changes.push(next)}
				/>,
			);
			fireEvent.click(screen.getByRole("button", { name: "Add Images" }));
			yield* Effect.promise(() => screen.findByRole("status", { name: "Uploading Images" }));
			unmount();
			yield* Effect.promise(() =>
				act(() => {
					pending.resolve({ kind: "uploaded", asset: { type: "local", key: "late.png" } });
					return Effect.runPromiseWith(context)(
						Effect.promise(() => pending.promise).pipe(Effect.asVoid),
					);
				}),
			);
			expect(changes).toEqual([]);
		}),
	);
	it.live("appends an uploaded asset after the existing ones", () =>
		Effect.gen(function* () {
			const changes: Array<readonly AssetLocator[]> = [];
			const requests: string[] = [];
			render(
				<Harness
					pick={picked}
					onChange={(next) => changes.push(next)}
					upload={(request) => {
						requests.push(`${request.fileName}:${request.contentType}`);
						return Promise.resolve({
							kind: "uploaded",
							asset: { type: "local", key: "images/new.png" },
						});
					}}
				/>,
			);

			fireEvent.click(screen.getByRole("button", { name: "Add Images" }));

			yield* Effect.promise(() => waitFor(() => expect(screen.getByText("images/new.png"))));
			expect(requests).toEqual(["photo.png:image/png"]);
			expect(changes).toEqual([
				[
					{ type: "local", key: "images/a.png" },
					{ type: "local", key: "images/new.png" },
				],
			]);
		}),
	);

	it.live("keeps the list and reports an upload failure", () =>
		Effect.gen(function* () {
			const changes: Array<readonly AssetLocator[]> = [];
			render(
				<Harness
					pick={picked}
					onChange={(next) => changes.push(next)}
					upload={() => Promise.resolve({ kind: "failed", message: "Upload failed" })}
				/>,
			);

			fireEvent.click(screen.getByRole("button", { name: "Add Images" }));

			const alert = yield* Effect.promise(() => screen.findByRole("alert"));
			expect(alert.textContent).toContain("Upload failed");
			expect(changes).toEqual([]);
			expect(screen.getByText("images/a.png")).toBeTruthy();
		}),
	);

	it.live("does nothing when the picker is canceled", () =>
		Effect.gen(function* () {
			const requests: string[] = [];
			render(
				<Harness
					onChange={() => undefined}
					pick={{ kind: "canceled" }}
					upload={(request) => {
						requests.push(request.fileName);
						return Promise.resolve({ kind: "failed", message: "unused" });
					}}
				/>,
			);

			fireEvent.click(screen.getByRole("button", { name: "Add Images" }));
			yield* Effect.promise(() => Promise.resolve());

			expect(requests).toEqual([]);
		}),
	);
});
