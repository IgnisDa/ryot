import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import * as Effect from "effect/Effect";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { FieldMessage } from "../../text-field";
import type { SchemaFileIcons } from "../file/field";
import type { SchemaFilePickOutcome } from "../file/upload";
import type { SchemaAssetUpload } from "./upload";

type SchemaAssetState =
	| { readonly status: "idle" }
	| { readonly status: "uploading" }
	| { readonly status: "failed"; readonly message: string };

const assetKey = (asset: AssetLocator, index: number) =>
	`${asset.type === "remote" ? asset.url : asset.key}:${index}`;

export function SchemaAssetField(props: {
	readonly label: string;
	readonly icons: SchemaFileIcons;
	readonly value: readonly AssetLocator[];
	readonly uploadAsset: SchemaAssetUpload;
	readonly pickFile: () => Promise<SchemaFilePickOutcome>;
	readonly renderAsset: (asset: AssetLocator) => ReactNode;
	readonly onChange: (value: readonly AssetLocator[]) => void;
}) {
	const attempt = useRef(0);
	const mounted = useRef(true);
	const [state, setState] = useState<SchemaAssetState>({ status: "idle" });

	useLayoutEffect(
		() => () => {
			mounted.current = false;
			attempt.current = attempt.current + 1;
		},
		[],
	);

	const add = () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const token = ++attempt.current;
				const isCurrent = () => mounted.current && token === attempt.current;
				const picked = yield* Effect.promise(() => props.pickFile());
				if (!isCurrent() || picked.kind !== "picked") {
					return;
				}
				setState({ status: "uploading" });
				const outcome = yield* Effect.promise(() =>
					props.uploadAsset({
						source: picked.file.source,
						fileName: picked.file.name,
						contentType: picked.file.contentType,
					}),
				);
				if (!isCurrent()) {
					return;
				}
				if (outcome.kind === "failed") {
					setState({ status: "failed", message: outcome.message });
					return;
				}
				setState({ status: "idle" });
				props.onChange([...props.value, outcome.asset]);
			}),
		);

	return (
		<div className="flex flex-col gap-1.5">
			<ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
				{props.value.map((asset, index) => (
					<li
						key={assetKey(asset, index)}
						className="relative aspect-square overflow-hidden rounded-lg bg-surface-2"
					>
						{props.renderAsset(asset)}
						<button
							type="button"
							aria-label={`Remove ${props.label} ${index + 1}`}
							onClick={() => props.onChange(props.value.filter((_, current) => current !== index))}
							className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-pill bg-surface text-text pointer-coarse:size-11"
						>
							{props.icons.remove}
						</button>
					</li>
				))}
				<li className="aspect-square">
					<button
						type="button"
						onClick={() => void add()}
						aria-label={`Add ${props.label}`}
						disabled={state.status === "uploading"}
						className="flex size-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong text-text-subtle disabled:opacity-50"
					>
						{state.status === "uploading" ? (
							<span
								role="status"
								aria-busy="true"
								aria-label={`Uploading ${props.label}`}
								className="size-4 rounded-pill border-2 border-border-strong border-t-accent motion-reduce:border-t-border-strong"
							/>
						) : (
							<span aria-hidden="true">{props.icons.upload}</span>
						)}
						<span className="text-xs">Add</span>
					</button>
				</li>
			</ul>
			{state.status === "failed" ? <FieldMessage>{state.message}</FieldMessage> : null}
		</div>
	);
}
