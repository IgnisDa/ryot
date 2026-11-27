import {
	ActiveScreenContext,
	AssetArtWell,
	assetKey,
	collectManagedAssetLocators,
	createRyotQuery,
	ManagedAssetProvider,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	ChipRadioGroup,
	LoadMoreButton,
	Modal,
	StatusMessage,
	useShortcut,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { type ReactNode, type RefObject, useContext, useEffect, useRef, useState } from "react";

import { mediaGalleryRecipe } from "../../shared/artwork-recipes";
import type { MediaImage } from "../../shared/media-image";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { useMediaMessages } from "../messages";
import { MediaDetailModal } from "./detail-modal";
import { imageRendition } from "./image";
import {
	type GalleryFilter,
	galleryFilterImages,
	galleryFilters,
	galleryStep,
	galleryTileAspect,
	galleryTileColumns,
	galleryTileFit,
} from "./image-gallery-state";

const SWIPE_THRESHOLD = 44;

const DOT_LIMIT = 12;

const GALLERY_PAGE_SIZE = 12;
const STRIP_RADIUS = 2;

type GalleryProps = {
	readonly name: string;
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly onClose: () => void;
	readonly triggerRef: RefObject<null | HTMLElement>;
};

const galleryQuery = createRyotQuery<{ readonly entityId: string }, readonly MediaImage[]>(
	({ input, client }) =>
		client.data.query(
			mediaGalleryRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
			input,
		),
	{ cancelOnUnmount: true },
);

export function MediaEntityImageGallery(props: GalleryProps & { readonly entityId: string }) {
	const active = useContext(ActiveScreenContext);
	return active ? <ActiveMediaEntityGallery {...props} /> : null;
}

export function MediaImageGallery(
	props: GalleryProps & { readonly status?: ReactNode; readonly images: readonly MediaImage[] },
) {
	const text = useMediaMessages();
	const [filter, setFilter] = useState<GalleryFilter>("all");
	const [lightbox, setLightbox] = useState<number>();
	const [tileLimit, setTileLimit] = useState(GALLERY_PAGE_SIZE);
	const tileRef = useRef<null | HTMLElement>(null);
	const gridRef = useRef<HTMLDivElement>(null);
	const visible = galleryFilterImages(props.images, filter);
	const tiles = visible.slice(0, tileLimit);

	const selectFilter = (next: GalleryFilter) => {
		setFilter(next);
		setTileLimit(GALLERY_PAGE_SIZE);
		if (gridRef.current !== null) {
			gridRef.current.scrollTop = 0;
		}
	};

	return (
		<ManagedAssetProvider assets={collectManagedAssetLocators(tiles)}>
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
					props.status === undefined && (
						<span className="font-ui text-[12px] text-text-muted">
							{text("gallery.count", { count: visible.length })}
						</span>
					)
				}
				overlay={
					lightbox === undefined ? null : (
						<Modal
							triggerRef={tileRef}
							onClose={() => setLightbox(undefined)}
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
				{props.status}
				<div className={clsx("grid gap-2.5", galleryTileColumns(filter, props.compact))}>
					{tiles.map((image, index) => (
						<button
							type="button"
							key={assetKey(image)}
							aria-label={text("gallery.view-image", { index: index + 1 })}
							className="rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
							onClick={(event) => {
								tileRef.current = event.currentTarget;
								setLightbox(index);
							}}
						>
							<AssetArtWell
								monogram={props.name}
								fit={galleryTileFit(filter)}
								asset={imageRendition(image, "thumbnail")}
								className={clsx("w-full", galleryTileAspect(filter))}
							/>
						</button>
					))}
				</div>
				{tiles.length < visible.length && (
					<div className="flex justify-center pt-4">
						<LoadMoreButton
							isFetchingNextPage={false}
							onClick={() => setTileLimit(tileLimit + GALLERY_PAGE_SIZE)}
						/>
					</div>
				)}
			</MediaDetailModal>
		</ManagedAssetProvider>
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

function ActiveMediaEntityGallery(props: GalleryProps & { readonly entityId: string }) {
	const text = useMediaMessages();
	const query = useRyotQuery(galleryQuery, { entityId: props.entityId });
	let status: ReactNode;
	if (query.data === undefined) {
		status = query.isError ? (
			<StatusMessage tone="error" action={{ onClick: query.refetch, label: text("gallery.retry") }}>
				{text("gallery.error")}
			</StatusMessage>
		) : (
			<StatusMessage tone="pending">{text("gallery.loading")}</StatusMessage>
		);
	}
	return <MediaImageGallery {...props} status={status} images={query.data ?? []} />;
}

function GalleryFilterRow(props: {
	readonly active: GalleryFilter;
	readonly images: readonly MediaImage[];
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
	readonly images: readonly MediaImage[];
	readonly onSelect: (index: number) => void;
}) {
	const { index, images } = props;
	const text = useMediaMessages();
	const stripRef = useRef<HTMLDivElement>(null);
	const start = Math.max(0, index - STRIP_RADIUS);
	const thumbnails = images.slice(start, index + STRIP_RADIUS + 1);

	useEffect(() => {
		const strip = stripRef.current;
		const active = strip?.firstElementChild?.children[index - start];
		if (!strip || !(active instanceof HTMLElement)) {
			return;
		}
		strip.scrollLeft = active.offsetLeft - (strip.clientWidth - active.clientWidth) / 2;
	}, [index, start]);

	if (props.compact) {
		if (images.length > DOT_LIMIT) {
			return null;
		}
		return (
			<div className="flex justify-center gap-1.5 py-4">
				{images.map((dot, dotIndex) => (
					<span
						key={assetKey(dot)}
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
		<ManagedAssetProvider assets={collectManagedAssetLocators(thumbnails)}>
			<div ref={stripRef} className="overflow-x-auto px-4 py-3">
				<div className="flex w-max gap-1.5">
					{thumbnails.map((thumb, offset) => {
						const thumbIndex = start + offset;
						return (
							<button
								type="button"
								key={assetKey(thumb)}
								onClick={() => props.onSelect(thumbIndex)}
								aria-label={text("gallery.go-to-image", { index: thumbIndex + 1 })}
								className={clsx(
									"w-16 shrink-0 rounded-sm",
									thumbIndex === index ? "outline-2 outline-accent" : "opacity-45",
								)}
							>
								<AssetArtWell
									state="ready"
									monogram={props.name}
									className="aspect-video w-full"
									asset={imageRendition(thumb, "thumbnail")}
								/>
							</button>
						);
					})}
				</div>
			</div>
		</ManagedAssetProvider>
	);
}

function GalleryLightboxBody(props: {
	readonly name: string;
	readonly index: number;
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly onClose: () => void;
	readonly images: readonly MediaImage[];
	readonly onSelect: (index: number) => void;
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
				<ManagedAssetProvider assets={collectManagedAssetLocators([image])}>
					<AssetArtWell
						fit="contain"
						loading="eager"
						monogram={props.name}
						asset={imageRendition(image, "large")}
						className="max-h-full min-h-0 w-full flex-1"
					/>
				</ManagedAssetProvider>
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
