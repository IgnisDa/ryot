import { ChipRadioGroup, Modal, useShortcut } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { type RefObject, useEffect, useRef, useState } from "react";

import { useMediaMessages } from "../messages";
import { MediaDetailModal } from "./detail-modal";
import type { MediaGalleryImage } from "./image";
import {
	type GalleryFilter,
	galleryFilterImages,
	galleryFilters,
	galleryStep,
	galleryTileAspect,
	galleryTileColumns,
	galleryTileFit,
} from "./image-gallery-state";
import { imageAssetKey, ManagedAssetImage } from "./managed-assets";

const SWIPE_THRESHOLD = 44;

const DOT_LIMIT = 12;

export function MediaImageGallery(props: {
	readonly name: string;
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly onClose: () => void;
	readonly images: readonly MediaGalleryImage[];
	readonly triggerRef: RefObject<null | HTMLElement>;
}) {
	const text = useMediaMessages();
	const [filter, setFilter] = useState<GalleryFilter>("all");
	const [lightbox, setLightbox] = useState<number>();
	const tileRef = useRef<null | HTMLElement>(null);
	const gridRef = useRef<HTMLDivElement>(null);
	const visible = galleryFilterImages(props.images, filter);

	const selectFilter = (next: GalleryFilter) => {
		setFilter(next);
		if (gridRef.current !== null) {
			gridRef.current.scrollTop = 0;
		}
	};

	return (
		<MediaDetailModal
			contentRef={gridRef}
			compact={props.compact}
			onClose={props.onClose}
			triggerRef={props.triggerRef}
			title={text("property.images")}
			safeAreaTop={props.safeAreaTop}
			closeLabel={text("gallery.close")}
			label={text("gallery.label", { name: props.name })}
			toolbar={<GalleryFilterRow active={filter} images={props.images} onSelect={selectFilter} />}
			headerAside={
				<span className="font-ui text-[12px] text-text-muted">
					{text("gallery.count", { count: visible.length })}
				</span>
			}
			overlay={
				lightbox === undefined ? null : (
					<Modal
						triggerRef={tileRef}
						onClose={() => setLightbox(undefined)}
						closeLabel={text("gallery.close-image")}
						className="flex h-full w-full flex-col bg-bg"
						label={text("gallery.position", { index: lightbox + 1, total: visible.length })}
					>
						<GalleryLightboxBody
							images={visible}
							index={lightbox}
							name={props.name}
							onSelect={setLightbox}
							compact={props.compact}
							safeAreaTop={props.safeAreaTop}
							onClose={() => setLightbox(undefined)}
						/>
					</Modal>
				)
			}
		>
			<div className={clsx("grid gap-2.5", galleryTileColumns(filter, props.compact))}>
				{visible.map((image, index) => (
					<button
						type="button"
						key={imageAssetKey(image)}
						aria-label={text("gallery.view-image", { index: index + 1 })}
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
		</MediaDetailModal>
	);
}

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
	const text = useMediaMessages();
	const filters = galleryFilters(props.images);
	if (filters.length === 0) {
		return null;
	}
	return (
		<ChipRadioGroup
			overflow="scroll"
			value={props.active}
			className="px-4 pb-3"
			onChange={props.onSelect}
			label={text("gallery.filter-label")}
			options={filters.map((option) => ({
				value: option.filter,
				label: text("gallery.filter-option", { count: option.count, filter: option.filter }),
			}))}
		/>
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
	const text = useMediaMessages();
	const stripRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const strip = stripRef.current;
		const active = strip?.firstElementChild?.children[index];
		if (!strip || !(active instanceof HTMLElement)) {
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
						aria-label={text("gallery.go-to-image", { index: thumbIndex + 1 })}
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
	readonly safeAreaTop: number;
	readonly onClose: () => void;
	readonly onSelect: (index: number) => void;
	readonly images: readonly MediaGalleryImage[];
}) {
	const { index, images } = props;
	const text = useMediaMessages();
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
			<div
				className="flex items-center justify-between gap-4 px-4 py-3"
				style={{ paddingTop: props.compact ? props.safeAreaTop + 12 : undefined }}
			>
				<div className="flex items-center gap-3">
					<span className="font-ui font-medium text-[13px] text-text tabular-nums">
						{text("gallery.counter", { index: index + 1, total: images.length })}
					</span>
					<span className="rounded-pill border border-border px-2.5 py-0.5 font-ui text-[11px] text-text-muted">
						{text("gallery.purpose", { purpose: image.purpose })}
					</span>
				</div>
				<GalleryCloseButton onClick={props.onClose} label={text("gallery.close-image")} />
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
						aria-label={text("gallery.previous")}
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
						aria-label={text("gallery.next")}
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
