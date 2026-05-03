import clsx from "clsx";
import { LinearGradient } from "expo-linear-gradient";
import { Star } from "lucide-react-native";
import { useState } from "react";
import { Image, ImageBackground, ScrollView, useWindowDimensions } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";

// ─── Design tokens ────────────────────────────────────────────────────────────

const SCHEMA_COLORS: Record<string, string> = {
	"comic-book": "#45AAF2",
	anime: "#E55B7A",
	audiobook: "#2E86AB",
	book: "#5B8A5F",
	manga: "#9B59B6",
	movie: "#E09840",
	music: "#FC5C65",
	podcast: "#F7B731",
	show: "#5B7FFF",
	tv: "#5B7FFF",
};

export const SECTION_ACCENTS = {
	activity: "#6F8B75",
	continue: "#C9943A",
	rateThese: "#D38D5A",
	upNext: "#8E6A4D",
};

// Story ring geometry
const RING_SIZE = 72;
const RING_STROKE = 3.5;
const RING_GAP = 2.5;
const THUMB_SIZE = RING_SIZE - RING_STROKE * 2 - RING_GAP * 2;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_R;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number) {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function schemaColor(slug: string) {
	return SCHEMA_COLORS[slug] ?? "#78716c";
}

function timeAgo(date: Date) {
	const diffMs = Date.now() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	if (diffMins < 60) {
		return `${diffMins}m ago`;
	}
	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) {
		return `${diffHours}h ago`;
	}
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 7) {
		return `${diffDays}d ago`;
	}
	return `${Math.floor(diffDays / 7)}w ago`;
}

function activityLabel(eventSchemaSlug: string, rating: number | null) {
	if (eventSchemaSlug === "progress") {
		return "Logged progress";
	}
	if (eventSchemaSlug === "backlog") {
		return "Added to queue";
	}
	if (eventSchemaSlug === "complete") {
		return "Completed";
	}
	if (eventSchemaSlug === "review") {
		return rating !== null ? `Rated ${rating}/10` : "Reviewed";
	}
	return "Updated";
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContinueItem = {
	id: string;
	entitySchemaSlug: string;
	imageUri: string | null;
	labels: { cta: string; progress: string };
	progress: { currentUnits: number; progressPercent: number; totalUnits: number };
	title: string;
};

export type UpNextItem = {
	id: string;
	entitySchemaSlug: string;
	imageUri: string | null;
	labels: { cta: string };
	subtitle: { label: string | null; raw: number | null };
	title: string;
};

export type RateItem = {
	id: string;
	completedAt: Date;
	entitySchemaSlug: string;
	imageUri: string | null;
	rating: number | null;
	title: string;
};

export type ActivityItem = {
	id: string;
	entityId: string;
	entityName: string;
	entitySchemaSlug: string;
	eventSchemaSlug: string;
	imageUri: string | null;
	occurredAt: Date;
	rating: number | null;
};

// ─── Shared primitives ────────────────────────────────────────────────────────

export function StatPill({ color, label }: { color: string; label: string }) {
	return (
		<Box className="rounded-full px-2.5 py-1" style={{ backgroundColor: hexToRgba(color, 0.12) }}>
			<Text className="text-[11px] font-sans-medium" style={{ color }}>
				{label}
			</Text>
		</Box>
	);
}

function SectionLabel({ color, label }: { color: string; label: string }) {
	return (
		<Box className="mb-4 mt-8 flex-row items-center gap-3">
			<Box className="h-px flex-1" style={{ backgroundColor: hexToRgba(color, 0.35) }} />
			<Text className="text-[10px] font-sans-semibold uppercase tracking-[2px]" style={{ color }}>
				{label}
			</Text>
			<Box className="h-px flex-1" style={{ backgroundColor: hexToRgba(color, 0.35) }} />
		</Box>
	);
}

function StarRating({ rating, onChange }: { rating: number; onChange: (r: number) => void }) {
	const gold = SECTION_ACCENTS.continue;
	return (
		<Box className="flex-row gap-1.5">
			{[1, 2, 3, 4, 5].map((i) => (
				<Pressable key={i} onPress={() => onChange(i === rating ? 0 : i)} hitSlop={8}>
					<Star
						fill={i <= rating ? gold : "transparent"}
						color={i <= rating ? gold : "#a8a29e"}
						size={20}
						strokeWidth={1.5}
					/>
				</Pressable>
			))}
		</Box>
	);
}

// ─── Story rings (Continue section) ──────────────────────────────────────────

function StoryRing({ item }: { item: ContinueItem }) {
	const color = schemaColor(item.entitySchemaSlug);
	const dashOffset = RING_CIRC * (1 - item.progress.progressPercent / 100);
	const ringWidth = RING_SIZE + 8;

	return (
		<Pressable style={{ alignItems: "center", width: ringWidth }}>
			<Box style={{ height: RING_SIZE, width: RING_SIZE }}>
				{/* SVG progress ring */}
				<Svg width={RING_SIZE} height={RING_SIZE} style={{ position: "absolute", left: 0, top: 0 }}>
					{/* Track */}
					<Circle
						cx={RING_SIZE / 2}
						cy={RING_SIZE / 2}
						r={RING_R}
						stroke={hexToRgba(color, 0.18)}
						strokeWidth={RING_STROKE}
						fill="none"
					/>
					{/* Progress arc */}
					<Circle
						cx={RING_SIZE / 2}
						cy={RING_SIZE / 2}
						r={RING_R}
						stroke={color}
						strokeWidth={RING_STROKE}
						fill="none"
						strokeDasharray={`${RING_CIRC} ${RING_CIRC}`}
						strokeDashoffset={dashOffset}
						strokeLinecap="round"
						transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
					/>
				</Svg>
				{/* Circular thumbnail */}
				<Box
					style={{
						borderRadius: THUMB_SIZE / 2,
						height: THUMB_SIZE,
						left: RING_STROKE + RING_GAP,
						overflow: "hidden",
						position: "absolute",
						top: RING_STROKE + RING_GAP,
						width: THUMB_SIZE,
						backgroundColor: hexToRgba(color, 0.18),
					}}
				>
					{item.imageUri ? (
						<Image
							source={{ uri: item.imageUri }}
							style={{ height: THUMB_SIZE, width: THUMB_SIZE }}
							resizeMode="cover"
						/>
					) : (
						<Box className="flex-1 items-center justify-center">
							<Text
								style={{ color, fontSize: 7 }}
								className="text-center font-sans-medium uppercase"
								numberOfLines={3}
							>
								{item.title}
							</Text>
						</Box>
					)}
				</Box>
			</Box>
			<Text
				className="mt-1 text-center text-[8px] font-mono text-muted-foreground"
				style={{ width: ringWidth }}
				numberOfLines={1}
			>
				{item.labels.progress}
			</Text>
			<Text
				className="mt-0.5 text-center text-[10px] font-sans-medium text-foreground"
				style={{ width: ringWidth }}
				numberOfLines={2}
			>
				{item.title}
			</Text>
		</Pressable>
	);
}

export function StoryRingRow({ items, wrap }: { items: ContinueItem[]; wrap?: boolean }) {
	if (items.length === 0) {
		return null;
	}
	if (wrap) {
		return (
			<Box className="flex-row flex-wrap" style={{ gap: 16 }}>
				{items.map((item) => (
					<StoryRing key={item.id} item={item} />
				))}
			</Box>
		);
	}
	return (
		<ScrollView
			horizontal
			showsHorizontalScrollIndicator={false}
			contentContainerStyle={{ gap: 16, paddingHorizontal: 28 }}
		>
			{items.map((item) => (
				<StoryRing key={item.id} item={item} />
			))}
		</ScrollView>
	);
}

// ─── Up Next (responsive grid) ────────────────────────────────────────────────

export function UpNextSection({ items }: { items: UpNextItem[] }) {
	const { width } = useWindowDimensions();
	const effectiveWidth = Math.min(width, 1200);
	const cols = effectiveWidth >= 900 ? 4 : effectiveWidth >= 640 ? 3 : 2;
	const cardWidth = (effectiveWidth - 56 - 12 * (cols - 1)) / cols;
	const posterHeight = cardWidth * 1.5;

	return (
		<Box>
			<SectionLabel color={SECTION_ACCENTS.upNext} label="Up Next" />
			<Box className="flex-row flex-wrap" style={{ gap: 12 }}>
				{items.map((item) => {
					const color = schemaColor(item.entitySchemaSlug);
					return (
						<Pressable key={item.id} style={{ width: cardWidth }}>
							<Box
								style={{
									borderRadius: 10,
									height: posterHeight,
									overflow: "hidden",
									backgroundColor: hexToRgba(color, 0.13),
								}}
							>
								{item.imageUri ? (
									<Image
										source={{ uri: item.imageUri }}
										style={{ height: posterHeight, width: cardWidth }}
										resizeMode="cover"
									/>
								) : (
									<Box className="flex-1 items-center justify-center px-3">
										<Text
											className="text-center text-[10px] font-sans-medium uppercase tracking-[1px]"
											style={{ color }}
											numberOfLines={4}
										>
											{item.title}
										</Text>
									</Box>
								)}
								<Box
									className="absolute left-2 top-2 rounded px-1 py-0.5"
									style={{ backgroundColor: hexToRgba(color, 0.32) }}
								>
									<Text
										className="text-[8px] font-sans-medium uppercase tracking-[0.5px]"
										style={{ color }}
									>
										{item.entitySchemaSlug}
									</Text>
								</Box>
							</Box>
							<Text
								className="mt-1.5 text-[11px] font-sans-medium text-foreground"
								numberOfLines={2}
							>
								{item.title}
							</Text>
							{item.subtitle.label ? (
								<Text className="text-[10px] font-mono text-muted-foreground">
									{item.subtitle.label}
								</Text>
							) : null}
						</Pressable>
					);
				})}
			</Box>
		</Box>
	);
}

// ─── Rate These (stacked deck, one card at a time) ────────────────────────────

const DECK_POSTER_H = 210;

function RateCard({ item, onNext }: { item: RateItem; onNext: () => void }) {
	const [rating, setRating] = useState(0);
	const color = schemaColor(item.entitySchemaSlug);
	const gradientColors: [string, string] = ["transparent", "rgba(0,0,0,0.55)"];

	return (
		<Box
			style={{
				backgroundColor: "#ffffff",
				borderColor: hexToRgba(color, 0.18),
				borderRadius: 14,
				borderWidth: 1,
				overflow: "hidden",
			}}
		>
			{/* Poster */}
			<Box style={{ height: DECK_POSTER_H, backgroundColor: hexToRgba(color, 0.13) }}>
				<ImageBackground
					source={item.imageUri ? { uri: item.imageUri } : undefined}
					resizeMode="cover"
					style={{ flex: 1 }}
				>
					<LinearGradient
						colors={gradientColors}
						locations={[0.5, 1]}
						style={{ bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }}
					/>
					{/* Title overlay at bottom of image */}
					<Box style={{ bottom: 14, left: 14, position: "absolute", right: 14 }}>
						<Box
							className="mb-1 self-start rounded px-1.5 py-0.5"
							style={{ backgroundColor: hexToRgba(color, 0.38) }}
						>
							<Text
								className="text-[9px] font-sans-medium uppercase tracking-[0.5px]"
								style={{ color }}
							>
								{item.entitySchemaSlug}
							</Text>
						</Box>
						<Text
							className="font-heading-semibold text-white"
							style={{ fontSize: 18, lineHeight: 22 }}
							numberOfLines={2}
						>
							{item.title}
						</Text>
					</Box>
				</ImageBackground>
			</Box>
			{/* Action area */}
			<Box className="px-4 py-4">
				<Text className="mb-3 text-[11px] font-sans text-muted-foreground">
					How would you rate this?
				</Text>
				<Box className="flex-row items-center justify-between">
					<StarRating rating={rating} onChange={setRating} />
					<Pressable onPress={onNext} hitSlop={8}>
						<Text
							className={clsx(
								"text-[12px] font-sans-medium",
								rating > 0 ? "font-sans-semibold" : "text-muted-foreground",
							)}
							style={rating > 0 ? { color } : undefined}
						>
							{rating > 0 ? "Save →" : "Skip →"}
						</Text>
					</Pressable>
				</Box>
			</Box>
		</Box>
	);
}

export function RateTheseSection({ items }: { items: RateItem[] }) {
	const [idx, setIdx] = useState(0);

	if (items.length === 0) {
		return null;
	}

	return (
		<Box>
			<SectionLabel color={SECTION_ACCENTS.rateThese} label="Rate These" />
			{idx >= items.length ? (
				<Box className="items-center py-6">
					<Text className="text-[13px] font-sans text-muted-foreground">All caught up ✓</Text>
				</Box>
			) : (
				<Box style={{ paddingBottom: 10 }}>
					{/* Back card hint — next item peeking behind */}
					{idx + 1 < items.length ? (
						<Box
							style={{
								backgroundColor: hexToRgba(schemaColor(items[idx + 1].entitySchemaSlug), 0.07),
								borderColor: hexToRgba(schemaColor(items[idx + 1].entitySchemaSlug), 0.14),
								borderRadius: 14,
								borderWidth: 1,
								bottom: 0,
								left: 12,
								position: "absolute",
								right: 12,
								top: 10,
							}}
						/>
					) : null}
					{/* Front card */}
					<RateCard key={items[idx].id} item={items[idx]} onNext={() => setIdx((i) => i + 1)} />
				</Box>
			)}
		</Box>
	);
}

// ─── Activity (timeline) ──────────────────────────────────────────────────────

export function ActivitySection({ items }: { items: ActivityItem[] }) {
	return (
		<Box>
			<SectionLabel color={SECTION_ACCENTS.activity} label="Recent Activity" />
			{items.map((item, idx) => {
				const color = schemaColor(item.entitySchemaSlug);
				const isLast = idx === items.length - 1;
				return (
					<Box key={item.id} className="flex-row">
						{/* Spine */}
						<Box className="items-center" style={{ paddingTop: 4, width: 20 }}>
							<Box
								style={{
									backgroundColor: color,
									borderRadius: 4,
									height: 8,
									width: 8,
								}}
							/>
							{!isLast ? (
								<Box
									className="flex-1"
									style={{
										backgroundColor: hexToRgba(color, 0.2),
										marginTop: 4,
										width: 1,
									}}
								/>
							) : null}
						</Box>
						{/* Content */}
						<Box className={clsx("flex-1 pl-3", isLast ? "pb-2" : "pb-4")}>
							<Box className="flex-row items-baseline gap-2">
								<Text
									className="flex-1 text-[13px] font-sans-medium text-foreground"
									numberOfLines={1}
								>
									{item.entityName}
								</Text>
								<Text className="text-[10px] font-mono text-stone-400">
									{timeAgo(item.occurredAt)}
								</Text>
							</Box>
							<Box className="mt-0.5 flex-row items-center gap-1.5">
								<Text className="text-[11px] font-sans-medium" style={{ color }}>
									{activityLabel(item.eventSchemaSlug, item.rating)}
								</Text>
								<Box
									className="rounded px-1 py-px"
									style={{ backgroundColor: hexToRgba(color, 0.12) }}
								>
									<Text
										className="text-[8px] font-sans-medium uppercase tracking-[0.5px]"
										style={{ color }}
									>
										{item.entitySchemaSlug}
									</Text>
								</Box>
							</Box>
						</Box>
					</Box>
				);
			})}
		</Box>
	);
}
