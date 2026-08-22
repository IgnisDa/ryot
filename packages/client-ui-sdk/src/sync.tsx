import clsx from "clsx";
import { useState, type ReactNode } from "react";

import { entityMonogram, type FieldSyncState, type SyncReason } from "./sync-state";

export {
	entityMonogram,
	fieldSyncState,
	isTitleProvisional,
	type EntitySyncState,
	type FieldSyncState,
	type SyncReason,
	type SyncStatus,
} from "./sync-state";

export const SETTLE_RING_DURATION_MS = 900;

type ArtShape = "rounded" | "circle";

const reasonBackground = (reason: SyncReason) =>
	reason === "translating" ? "bg-translate" : "bg-info";

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

export function EntityArtWell(props: {
	readonly monogram: string;
	readonly className: string;
	readonly state: FieldSyncState;
	readonly url: string | undefined;
	readonly shape?: ArtShape | undefined;
}) {
	const [failedUrl, setFailedUrl] = useState<string>();
	if (props.url !== undefined && failedUrl !== props.url) {
		return (
			<img
				alt=""
				loading="lazy"
				key={props.url}
				src={props.url}
				onError={() => setFailedUrl(props.url)}
				className={clsx(
					props.className,
					"overflow-hidden bg-surface-2 object-cover",
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

export function SettleHighlight(props: {
	readonly children: ReactNode;
	readonly className?: string | undefined;
	readonly reason: SyncReason | undefined;
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

export function TranslationChip(props: { readonly icon: ReactNode }) {
	return (
		<span className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface-2 px-2.5 py-1 font-ui text-[12px] text-text-muted">
			<span className="text-translate">{props.icon}</span>
			Translating...
		</span>
	);
}

export function SyncCountLine(props: {
	readonly populating: number;
	readonly translating: number;
}) {
	if (props.populating === 0 && props.translating === 0) {
		return null;
	}
	return (
		<span className="inline-flex items-center gap-2">
			{props.populating > 0 && (
				<span className="inline-flex items-center gap-1.5">
					<SyncPip reason="populating" />
					{`${props.populating} populating`}
				</span>
			)}
			{props.populating > 0 && props.translating > 0 && <span aria-hidden="true">·</span>}
			{props.translating > 0 && (
				<span className="inline-flex items-center gap-1.5">
					<SyncPip reason="translating" />
					{`${props.translating} translating`}
				</span>
			)}
		</span>
	);
}
