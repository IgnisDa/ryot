import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import clsx from "clsx";
import { type ImgHTMLAttributes, type ReactNode, useState } from "react";

import { entityMonogram, type FieldSyncState, type SyncReason } from "./sync-state";

export {
	entityMonogram,
	fieldSyncState,
	type SyncReason,
	isTitleProvisional,
	isEnrichmentActive,
	type FieldSyncState,
} from "./sync-state";

export const SETTLE_RING_DURATION_MS = 900;

type ArtFit = "cover" | "contain";

type ArtShape = "circle" | "rounded";

const reasonBackground = (reason: SyncReason) =>
	reason === "translating" ? "bg-translate" : "bg-info";

const fitClassName = (fit: ArtFit | undefined) =>
	fit === "contain" ? "object-contain" : "object-cover";

const shapeClassName = (shape: ArtShape | undefined) => {
	if (shape === undefined) {
		return undefined;
	}
	return shape === "circle" ? "rounded-full" : "rounded-lg";
};

export function SyncPip(props: {
	readonly reason: SyncReason;
	readonly className?: string | undefined;
}) {
	return (
		<span
			aria-hidden="true"
			className={clsx(
				"inline-block size-1.5 shrink-0 rounded-full animate-sync-pulse motion-reduce:animate-none",
				reasonBackground(props.reason),
				props.className,
			)}
		/>
	);
}

export function TranslationChip(props: { readonly icon: ReactNode }) {
	const t = useT();
	return (
		<span className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface-2 px-2.5 py-1 font-ui text-xs text-text-muted">
			<span className="text-translate">{props.icon}</span>
			{t(kernelMessage("ui.sync.translating"))}
		</span>
	);
}

export function SettleHighlight(props: {
	readonly children: ReactNode;
	readonly className?: string | undefined;
	readonly reason: undefined | SyncReason;
}) {
	return (
		<div
			className={clsx(
				props.className,
				props.reason === "populating" &&
					"animate-settle-ring [--settle-ring-color:var(--info)] motion-reduce:animate-none",
				props.reason === "translating" &&
					"animate-settle-ring [--settle-ring-color:var(--translate)] motion-reduce:animate-none",
			)}
		>
			{props.children}
		</div>
	);
}

export function SyncCountLine(props: {
	readonly populating: number;
	readonly translating: number;
}) {
	const t = useT();
	if (props.populating === 0 && props.translating === 0) {
		return null;
	}
	return (
		<span className="inline-flex items-center gap-2">
			{props.populating > 0 && (
				<span className="inline-flex items-center gap-1.5">
					<SyncPip reason="populating" />
					{t(kernelMessage("ui.sync.populating-count", { count: props.populating }))}
				</span>
			)}
			{props.populating > 0 && props.translating > 0 && <span aria-hidden="true">·</span>}
			{props.translating > 0 && (
				<span className="inline-flex items-center gap-1.5">
					<SyncPip reason="translating" />
					{t(kernelMessage("ui.sync.translating-count", { count: props.translating }))}
				</span>
			)}
		</span>
	);
}

export function EntityArtWell(props: {
	readonly monogram: string;
	readonly className: string;
	readonly state: FieldSyncState;
	readonly url: string | undefined;
	readonly fit?: ArtFit | undefined;
	readonly shape?: ArtShape | undefined;
	readonly sizes?: ImgHTMLAttributes<HTMLImageElement>["sizes"];
	readonly srcSet?: ImgHTMLAttributes<HTMLImageElement>["srcSet"];
	readonly onLoad?: ImgHTMLAttributes<HTMLImageElement>["onLoad"];
	readonly loading?: ImgHTMLAttributes<HTMLImageElement>["loading"];
	readonly referrerPolicy?: ImgHTMLAttributes<HTMLImageElement>["referrerPolicy"];
}) {
	const [failedUrl, setFailedUrl] = useState<string>();
	if (props.url !== undefined && failedUrl !== props.url) {
		return (
			<img
				alt=""
				key={props.url}
				src={props.url}
				sizes={props.sizes}
				srcSet={props.srcSet}
				onLoad={props.onLoad}
				loading={props.loading ?? "lazy"}
				referrerPolicy={props.referrerPolicy}
				onError={() => setFailedUrl(props.url)}
				className={clsx(
					props.className,
					"overflow-hidden bg-surface-2",
					fitClassName(props.fit),
					shapeClassName(props.shape),
				)}
			/>
		);
	}
	const pending = props.state === "pending";
	return (
		<div
			className={clsx(
				props.className,
				"relative isolate grid place-items-center overflow-hidden bg-surface-2",
				shapeClassName(props.shape),
			)}
		>
			<span
				aria-hidden="true"
				className={clsx(
					"font-display font-semibold text-lg",
					pending ? "text-text-subtle/40" : "text-text-subtle",
				)}
			>
				{entityMonogram(props.monogram)}
			</span>
			{pending && (
				<span
					aria-hidden="true"
					className="pointer-events-none absolute inset-0 animate-sync-sweep bg-linear-to-r from-transparent via-raised to-transparent motion-reduce:animate-none"
				/>
			)}
			{pending && <SyncPip reason="populating" className="absolute top-1 right-1" />}
		</div>
	);
}
