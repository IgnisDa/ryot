import { Chip, Modal, useShortcut } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import clsx from "clsx";
import { useEffect, useRef, useState, type RefObject } from "react";

import {
	galleryCountLabel,
	galleryFilterImages,
	galleryFilters,
	galleryStep,
	galleryTileAspect,
	galleryTileColumns,
	galleryTileFit,
	type GalleryFilter,
} from "./image-gallery-state";
import { imageAssetKey, ManagedAssetImage } from "./managed-assets";
import type { MediaGalleryImage } from "./media-image";

const SWIPE_THRESHOLD = 44;

const DOT_LIMIT = 12;

function GalleryCloseButton(props: { readonly label: string; readonly onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={props.onClick}
			aria-label={props.label}
			className="rounded-full text-text-muted focus-visible:outline-2 focus-visible:outline-accent"
		>
			<AppIcon size={22} name="circle-x" />
		</button>
	);
}

function GalleryFilterRow(props: {
	readonly active: GalleryFilter;
	readonly images: readonly MediaGalleryImage[];
	readonly onSelect: (filter: GalleryFilter) => void;
}) {
	const filters = galleryFilters(props.images);
	if (filters.length === 0) {
		return null;
	}
	return (
		<div className="overflow-x-auto px-4 pb-3">
			<div role="radiogroup" aria-label="Filter images" className="flex w-max gap-2">
				{filters.map((option) => {
					const isSelected = option.filter === props.active;
					return (
						<button
							role="radio"
							type="button"
							key={option.filter}
							aria-checked={isSelected}
							onClick={() => props.onSelect(option.filter)}
							className="rounded-pill focus-visible:outline-2 focus-visible:outline-accent"
						>
							<Chip checked={isSelected} label={`${option.label} ${option.count}`} />
						</button>
					);
				})}
			</div>
		</div>
	);
}

function GalleryLightboxFooter(props: {
	readonly name: string;
	readonly index: number;
	readonly compact: boolean;
	readonly onSelect: (index: number) => void;
	readonly images: readonly MediaGalleryImage[];
}) {
	const { index, images } = props;
	const stripRef = useRef<HTMLDivElement>(null);
	const activeStripRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		const strip = stripRef.current;
		const active = activeStripRef.current;
		if (strip === null || active === null) {
			return;
		}
		strip.scrollLeft = active.offsetLeft - (strip.clientWidth - active.clientWidth) / 2;
	}, [index]);

	if (props.compact) {
		if (images.length > DOT_LIMIT) {
			return null;
		}
		return (
			<div className="flex justify-center gap-1.5 py-4">
				{images.map((dot, dotIndex) => (
					<span
						key={imageAssetKey(dot)}
						className={clsx(
							"h-1 rounded-pill",
							dotIndex === index ? "w-3.5 bg-accent" : "w-1 bg-border",
						)}
					/>
				))}
			</div>
		);
	}
	return (
		<div ref={stripRef} className="overflow-x-auto px-4 py-3">
			<div className="flex w-max gap-1.5">
				{images.map((thumb, thumbIndex) => (
					<button
						type="button"
						key={imageAssetKey(thumb)}
						onClick={() => props.onSelect(thumbIndex)}
						aria-label={`Go to image ${thumbIndex + 1}`}
						ref={thumbIndex === index ? activeStripRef : undefined}
						className={clsx(
							"w-16 shrink-0 rounded-sm",
							thumbIndex === index ? "outline-2 outline-accent" : "opacity-45",
						)}
					>
						<ManagedAssetImage
							asset={thumb}
							state="ready"
							monogram={props.name}
							className="aspect-video w-full"
						/>
					</button>
				))}
			</div>
		</div>
	);
}

function GalleryLightboxBody(props: {
	readonly name: string;
	readonly index: number;
	readonly compact: boolean;
	readonly onClose: () => void;
	readonly onSelect: (index: number) => void;
	readonly images: readonly MediaGalleryImage[];
}) {
	const { index, images } = props;
	const image = images[index];
	const pointerStart = useRef<number>(undefined);

	const step = (direction: 1 | -1) => props.onSelect(galleryStep(index, images.length, direction));

	useShortcut("ArrowLeft", () => step(-1));
	useShortcut("ArrowRight", () => step(1));
	useShortcut("Home", () => props.onSelect(0));
	useShortcut("End", () => props.onSelect(images.length - 1));

	if (image === undefined) {
		return null;
	}

	return (
		<>
			<div className="flex items-center justify-between gap-4 px-4 py-3">
				<div className="flex items-center gap-3">
					<span className="font-ui font-medium text-[13px] text-text tabular-nums">
						{`${index + 1} / ${images.length}`}
					</span>
					{image.purpose === undefined ? null : (
						<span className="rounded-pill border border-border px-2.5 py-0.5 font-ui text-[11px] text-text-muted">
							{image.purpose}
						</span>
					)}
				</div>
				<GalleryCloseButton label="Close image" onClick={props.onClose} />
			</div>
			<div
				className="flex min-h-0 flex-1 items-center justify-center gap-4 px-4"
				onPointerDown={(event) => {
					pointerStart.current = event.clientX;
				}}
				onPointerUp={(event) => {
					const start = pointerStart.current;
					pointerStart.current = undefined;
					if (start === undefined) {
						return;
					}
					const travelled = event.clientX - start;
					if (Math.abs(travelled) >= SWIPE_THRESHOLD) {
						step(travelled < 0 ? 1 : -1);
					}
				}}
			>
				{props.compact ? null : (
					<button
						type="button"
						disabled={index === 0}
						onClick={() => step(-1)}
						aria-label="Previous image"
						className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-text disabled:opacity-40"
					>
						<AppIcon size={18} name="chevron-left" />
					</button>
				)}
				<ManagedAssetImage
					fit="contain"
					state="ready"
					asset={image}
					monogram={props.name}
					className="max-h-full min-h-0 w-full flex-1"
				/>
				{props.compact ? null : (
					<button
						type="button"
						onClick={() => step(1)}
						aria-label="Next image"
						disabled={index === images.length - 1}
						className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-text disabled:opacity-40"
					>
						<AppIcon size={18} name="chevron-right" />
					</button>
				)}
			</div>
			<GalleryLightboxFooter
				index={index}
				images={images}
				name={props.name}
				compact={props.compact}
				onSelect={props.onSelect}
			/>
		</>
	);
}

export function MediaImageGallery(props: {
	readonly name: string;
	readonly compact: boolean;
	readonly onClose: () => void;
	readonly triggerRef: RefObject<HTMLElement | null>;
	readonly images: readonly MediaGalleryImage[];
}) {
	const [filter, setFilter] = useState<GalleryFilter>("all");
	const [lightbox, setLightbox] = useState<number>();
	const tileRef = useRef<HTMLElement | null>(null);
	const gridRef = useRef<HTMLDivElement>(null);
	const visible = galleryFilterImages(props.images, filter);

	const selectFilter = (next: GalleryFilter) => {
		setFilter(next);
		if (gridRef.current !== null) {
			gridRef.current.scrollTop = 0;
		}
	};

	return (
		<Modal
			onClose={props.onClose}
			closeLabel="Close images"
			triggerRef={props.triggerRef}
			label={`${props.name} images`}
			containerClassName={
				props.compact ? "items-stretch justify-stretch" : "items-center justify-center p-6"
			}
			className={clsx(
				"flex flex-col overflow-hidden bg-surface",
				props.compact
					? "h-full w-full"
					: "h-full max-h-[46rem] w-full max-w-5xl rounded-xl border border-border",
			)}
		>
			<div className="flex items-center justify-between gap-4 px-4 pt-4 pb-3">
				<div className="flex min-w-0 items-baseline gap-3">
					<h2 className="font-display font-semibold text-lg text-text">Images</h2>
					<span className="font-ui text-[12px] text-text-muted">
						{galleryCountLabel(visible.length)}
					</span>
				</div>
				<GalleryCloseButton label="Close images" onClick={props.onClose} />
			</div>
			<GalleryFilterRow active={filter} images={props.images} onSelect={selectFilter} />
			<div
				ref={gridRef}
				className="min-h-0 flex-1 overflow-y-auto border-border border-t px-4 py-4"
			>
				<div className={clsx("grid gap-2.5", galleryTileColumns(filter, props.compact))}>
					{visible.map((image, index) => (
						<button
							type="button"
							key={imageAssetKey(image)}
							aria-label={`View image ${index + 1}`}
							className="rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
							onClick={(event) => {
								tileRef.current = event.currentTarget;
								setLightbox(index);
							}}
						>
							<ManagedAssetImage
								asset={image}
								state="ready"
								monogram={props.name}
								fit={galleryTileFit(filter)}
								className={clsx("w-full", galleryTileAspect(filter))}
							/>
						</button>
					))}
				</div>
			</div>
			{lightbox === undefined ? null : (
				<Modal
					triggerRef={tileRef}
					closeLabel="Close image"
					onClose={() => setLightbox(undefined)}
					className="flex h-full w-full flex-col bg-bg"
					label={`Image ${lightbox + 1} of ${visible.length}`}
				>
					<GalleryLightboxBody
						images={visible}
						index={lightbox}
						name={props.name}
						onSelect={setLightbox}
						compact={props.compact}
						onClose={() => setLightbox(undefined)}
					/>
				</Modal>
			)}
		</Modal>
	);
}
