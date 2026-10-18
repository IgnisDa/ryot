import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import * as Effect from "effect/Effect";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { FieldMessage } from "../../text-field";
import type { SchemaFileIcons } from "../file/field";
import type { SchemaFilePickOutcome } from "../file/upload";
import type { SchemaAssetUpload } from "./upload";

type SchemaAssetState = { readonly valueKey: string } & (
	| { readonly status: "idle" }
	| { readonly status: "uploading" }
	| { readonly status: "failed"; readonly message: string }
);

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
	readonly maximum?: number | undefined;
	readonly replace?: boolean;
	readonly onReorder?: (() => void) | undefined;
}) {
	const attempt = useRef(0);
	const mounted = useRef(true);
	const valueKey = JSON.stringify(
		props.value.map((asset) =>
			asset.type === "remote"
				? { url: asset.url, type: asset.type }
				: { key: asset.key, type: asset.type },
		),
	);
	const currentValue = useRef(valueKey);
	const latest = useRef({ value: props.value, onChange: props.onChange });
	const [state, setState] = useState<SchemaAssetState>({ valueKey, status: "idle" });
	const uploading = state.valueKey === valueKey && state.status === "uploading";
	const replacing = props.replace === true && props.value.length > 0;

	useLayoutEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			attempt.current = attempt.current + 1;
		};
	}, []);
	useLayoutEffect(() => {
		currentValue.current = valueKey;
		attempt.current += 1;
	}, [valueKey]);
	useLayoutEffect(() => {
		latest.current = { value: props.value, onChange: props.onChange };
	}, [props.value, props.onChange]);

	const add = () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const token = ++attempt.current;
				const isCurrent = () =>
					mounted.current && token === attempt.current && currentValue.current === valueKey;
				const picked = yield* Effect.promise(() => props.pickFile());
				if (!isCurrent() || picked.kind !== "picked") {
					return;
				}
				setState({ valueKey, status: "uploading" });
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
					setState({ valueKey, status: "failed", message: outcome.message });
					return;
				}
				setState({ valueKey, status: "idle" });
				latest.current.onChange(
					props.replace ? [outcome.asset] : [...latest.current.value, outcome.asset],
				);
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
						{index === 0 ? null : (
							<button
								type="button"
								aria-label={`Move ${props.label} ${index + 1} up`}
								className="absolute bottom-1 left-1 rounded-pill bg-surface px-2 py-1 text-xs text-text"
								onClick={() => {
									const next = [...props.value];
									next.splice(index, 1);
									next.splice(index - 1, 0, asset);
									props.onChange(next);
									props.onReorder?.();
								}}
							>
								Move up
							</button>
						)}
					</li>
				))}
				<li className="aspect-square">
					<button
						type="button"
						onClick={() => void add()}
						aria-label={`${replacing ? "Replace" : "Add"} ${props.label}`}
						disabled={
							uploading ||
							(!props.replace && props.maximum !== undefined && props.value.length >= props.maximum)
						}
						className="flex size-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong text-text-subtle disabled:opacity-50"
					>
						{uploading ? (
							<span
								role="status"
								aria-busy="true"
								aria-label={`Uploading ${props.label}`}
								className="size-4 rounded-pill border-2 border-border-strong border-t-accent motion-reduce:border-t-border-strong"
							/>
						) : (
							<span aria-hidden="true">{props.icons.upload}</span>
						)}
						<span className="text-xs">{replacing ? "Replace" : "Add"}</span>
					</button>
				</li>
			</ul>
			{state.valueKey === valueKey && state.status === "failed" ? (
				<FieldMessage>{state.message}</FieldMessage>
			) : null}
		</div>
	);
}
