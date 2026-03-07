import { dayjs } from "@ryot/ts-utils";
import clsx from "clsx";
import { LinearGradient } from "expo-linear-gradient";
import { Star } from "lucide-react-native";
import { useState } from "react";
import { Image, ImageBackground, ScrollView } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import type { EntityImage } from "@/lib/image";

const FALLBACK_COLOR = "#78716c";

export const SECTION_ACCENTS = {
	activity: "#6F8B75",
	continue: "#C9943A",
	rateThese: "#D38D5A",
	upNext: "#8E6A4D",
};

const RING_SM = { gap: 2.5, size: 72, stroke: 3.5 };
const RING_LG = { gap: 3, size: 96, stroke: 4 };
const RING_XL = { gap: 3, size: 112, stroke: 4 };

export function hexToRgba(hex: string, alpha: number) {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function timeAgo(dateString: string) {
	const diff = dayjs().diff(dayjs(dateString), "minute");
	if (diff < 60) {
		return `${diff}m ago`;
	}
	const hours = Math.floor(diff / 60);
	if (hours < 24) {
		return `${hours}h ago`;
	}
	const days = Math.floor(hours / 24);
	if (days < 7) {
		return `${days}d ago`;
	}
	return `${Math.floor(days / 7)}w ago`;
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

export type ContinueItem = {
	id: string;
	title: string;
	image: EntityImage;
	entitySchemaSlug: string;
	labels: { cta: string; progress: string };
	progress: {
		totalUnits?: number | null;
		currentUnits?: number | null;
		progressPercent?: number | null;
	};
};

export type UpNextItem = {
	id: string;
	title: string;
	image: EntityImage;
	labels: { cta: string };
	entitySchemaSlug: string;
	subtitle: { raw?: number | null; label?: string | null };
};

export type RateItem = {
	id: string;
	title: string;
	image: EntityImage;
	rating: number | null;
	completedAt: string;
	entitySchemaSlug: string;
};

export type ActivityItem = {
	id: string;
	entityId: string;
	occurredAt: string;
	rating: number | null;
	eventSchemaSlug: string;
	entity: {
		name: string;
		image: EntityImage;
		entitySchemaSlug: string;
	};
};

export function StatPill({ color, label }: { color: string; label: string }) {
	return (
		<Box className="rounded-full px-2.5 py-1" style={{ backgroundColor: hexToRgba(color, 0.12) }}>
			<Text className="text-[13px] font-sans-medium web:text-[15px]" style={{ color }}>
				{label}
			</Text>
		</Box>
	);
}

export function StatCard({ color, count, label }: { color: string; count: number; label: string }) {
	return (
		<Box
			className="min-w-[110] rounded-xl px-4 py-3"
			style={{
				borderWidth: 1,
				borderColor: hexToRgba(color, 0.18),
				backgroundColor: hexToRgba(color, 0.09),
			}}
		>
			<Text
				className="text-[34px] font-heading-semibold leading-[36px] web:text-[40px] web:leading-[44px]"
				style={{ color }}
			>
				{count}
			</Text>
			<Text className="mt-0.5 text-xs font-sans-medium uppercase tracking-[1px] text-muted-foreground web:text-[14px]">
				{label}
			</Text>
		</Box>
	);
}

function SectionLabel({ color, label }: { color: string; label: string }) {
	return (
		<Box className="mb-4 mt-8 flex-row items-center gap-3">
			<Box className="h-px flex-1" style={{ backgroundColor: hexToRgba(color, 0.35) }} />
			<Text
				className="text-xs font-sans-semibold uppercase tracking-[2px] web:text-[14px]"
				style={{ color }}
			>
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

function StoryRing({
	item,
	color,
	large,
	xlarge,
	imageUrl,
}: {
	item: ContinueItem;
	color: string;
	imageUrl: string | undefined;
	large?: boolean;
	xlarge?: boolean;
}) {
	const { gap, size, stroke } = xlarge ? RING_XL : large ? RING_LG : RING_SM;
	const thumbSize = size - stroke * 2 - gap * 2;
	const r = (size - stroke) / 2;
	const circ = 2 * Math.PI * r;
	const progressPercent = item.progress.progressPercent ?? 0;
	const dashOffset = circ * (1 - progressPercent / 100);
	const ringWidth = size + 8;

	return (
		<Pressable style={{ alignItems: "center", width: ringWidth }}>
			<Box style={{ height: size, width: size }}>
				<Svg width={size} height={size} style={{ position: "absolute", left: 0, top: 0 }}>
					<Circle
						cx={size / 2}
						cy={size / 2}
						r={r}
						stroke={hexToRgba(color, 0.18)}
						strokeWidth={stroke}
						fill="none"
					/>
					<Circle
						cx={size / 2}
						cy={size / 2}
						r={r}
						stroke={color}
						strokeWidth={stroke}
						fill="none"
						strokeDasharray={`${circ} ${circ}`}
						strokeDashoffset={dashOffset}
						strokeLinecap="round"
						transform={`rotate(-90 ${size / 2} ${size / 2})`}
					/>
				</Svg>
				<Box
					style={{
						borderRadius: thumbSize / 2,
						height: thumbSize,
						left: stroke + gap,
						overflow: "hidden",
						position: "absolute",
						top: stroke + gap,
						width: thumbSize,
						backgroundColor: hexToRgba(color, 0.18),
					}}
				>
					{imageUrl ? (
						<Image
							source={{ uri: imageUrl }}
							style={{ height: thumbSize, width: thumbSize }}
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
				className="mt-1 text-center text-xs font-mono text-muted-foreground web:text-[14px]"
				style={{ width: ringWidth }}
				numberOfLines={1}
			>
				{item.labels.progress}
			</Text>
			<Text
				className="mt-0.5 text-center text-xs font-sans-medium text-foreground web:text-[14px]"
				style={{ width: ringWidth }}
				numberOfLines={2}
			>
				{item.title}
			</Text>
		</Pressable>
	);
}

export function StoryRingRow({
	items,
	large,
	wrap,
	wrapGap,
	xlarge,
	imageUrls,
	schemaColorMap,
}: {
	items: ContinueItem[];
	imageUrls: Map<string, string | undefined>;
	schemaColorMap: Map<string, string>;
	large?: boolean;
	wrap?: boolean;
	wrapGap?: number;
	xlarge?: boolean;
}) {
	if (items.length === 0) {
		return null;
	}
	if (wrap) {
		return (
			<Box className="flex-row flex-wrap" style={{ gap: wrapGap ?? 16 }}>
				{items.map((item) => (
					<StoryRing
						key={item.id}
						item={item}
						large={large}
						xlarge={xlarge}
						imageUrl={imageUrls.get(item.id)}
						color={schemaColorMap.get(item.entitySchemaSlug) ?? FALLBACK_COLOR}
					/>
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
				<StoryRing
					key={item.id}
					item={item}
					large={large}
					xlarge={xlarge}
					imageUrl={imageUrls.get(item.id)}
					color={schemaColorMap.get(item.entitySchemaSlug) ?? FALLBACK_COLOR}
				/>
			))}
		</ScrollView>
	);
}

export function UpNextSection({
	items,
	imageUrls,
	schemaColorMap,
}: {
	items: UpNextItem[];
	imageUrls: Map<string, string | undefined>;
	schemaColorMap: Map<string, string>;
}) {
	if (items.length === 0) {
		return null;
	}
	return (
		<Box>
			<SectionLabel color={SECTION_ACCENTS.upNext} label="Backlog" />
			<Box className="flex-row flex-wrap gap-3">
				{items.map((item) => {
					const color = schemaColorMap.get(item.entitySchemaSlug) ?? FALLBACK_COLOR;
					const imageUrl = imageUrls.get(item.id);
					return (
						<Pressable key={item.id} className="w-[48%] sm:w-[32%]">
							<Box
								className="aspect-[2/3] sm:max-h-60"
								style={{
									borderRadius: 10,
									overflow: "hidden",
									backgroundColor: hexToRgba(color, 0.13),
								}}
							>
								{imageUrl ? (
									<Image source={{ uri: imageUrl }} style={{ flex: 1 }} resizeMode="cover" />
								) : (
									<Box className="flex-1 items-center justify-center px-3">
										<Text
											className="text-center text-xs font-sans-medium uppercase tracking-[1px] web:text-[14px]"
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
										className="text-[10px] font-sans-medium uppercase tracking-[0.5px] web:text-xs"
										style={{ color }}
									>
										{item.entitySchemaSlug}
									</Text>
								</Box>
							</Box>
							<Text
								className="mt-1.5 text-[13px] font-sans-medium text-foreground web:text-[15px]"
								numberOfLines={2}
							>
								{item.title}
							</Text>
							{item.subtitle.label ? (
								<Text className="text-xs font-mono text-muted-foreground web:text-[14px]">
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

function RateCard({
	item,
	color,
	imageUrl,
	onNext,
}: {
	item: RateItem;
	color: string;
	imageUrl: string | undefined;
	onNext: () => void;
}) {
	const [cardWidth, setCardWidth] = useState(0);
	const [rating, setRating] = useState(0);
	const posterHeight = cardWidth > 0 ? Math.min(Math.round(cardWidth * 0.65), 300) : 210;
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
			onLayout={(e) => setCardWidth(e.nativeEvent.layout.width)}
		>
			<Box style={{ height: posterHeight, backgroundColor: hexToRgba(color, 0.13) }}>
				<ImageBackground
					source={imageUrl ? { uri: imageUrl } : undefined}
					resizeMode="cover"
					style={{ flex: 1 }}
				>
					<LinearGradient
						colors={gradientColors}
						locations={[0.5, 1]}
						style={{ bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }}
					/>
					<Box style={{ bottom: 14, left: 14, position: "absolute", right: 14 }}>
						<Box
							className="mb-1 self-start rounded px-1.5 py-0.5"
							style={{ backgroundColor: hexToRgba(color, 0.38) }}
						>
							<Text
								className="text-[11px] font-sans-medium uppercase tracking-[0.5px] web:text-[13px]"
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
			<Box className="px-4 py-4">
				<Text className="mb-3 text-[13px] font-sans text-muted-foreground web:text-[15px]">
					How would you rate this?
				</Text>
				<Box className="flex-row items-center justify-between">
					<StarRating rating={rating} onChange={setRating} />
					<Pressable onPress={onNext} hitSlop={8}>
						<Text
							className={clsx(
								"text-sm font-sans-medium web:text-[16px]",
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

export function RateTheseSection({
	items,
	imageUrls,
	schemaColorMap,
}: {
	items: RateItem[];
	imageUrls: Map<string, string | undefined>;
	schemaColorMap: Map<string, string>;
}) {
	const [idx, setIdx] = useState(0);

	if (items.length === 0) {
		return null;
	}

	return (
		<Box>
			<SectionLabel color={SECTION_ACCENTS.rateThese} label="Rate These" />
			{idx >= items.length ? (
				<Box className="items-center py-6">
					<Text className="text-[15px] font-sans text-muted-foreground web:text-[17px]">
						All caught up ✓
					</Text>
				</Box>
			) : (
				<Box style={{ paddingBottom: 10 }}>
					{/* Back card hint — next item peeking behind */}
					{idx + 1 < items.length ? (
						<Box
							style={{
								borderRadius: 14,
								borderWidth: 1,
								bottom: 0,
								left: 12,
								position: "absolute",
								right: 12,
								top: 10,
								backgroundColor: hexToRgba(
									schemaColorMap.get(items[idx + 1].entitySchemaSlug) ?? FALLBACK_COLOR,
									0.07,
								),
								borderColor: hexToRgba(
									schemaColorMap.get(items[idx + 1].entitySchemaSlug) ?? FALLBACK_COLOR,
									0.14,
								),
							}}
						/>
					) : null}
					<RateCard
						key={items[idx].id}
						item={items[idx]}
						imageUrl={imageUrls.get(items[idx].id)}
						color={schemaColorMap.get(items[idx].entitySchemaSlug) ?? FALLBACK_COLOR}
						onNext={() => setIdx((i) => i + 1)}
					/>
				</Box>
			)}
		</Box>
	);
}

export function ActivitySection({
	items,
	schemaColorMap,
}: {
	items: ActivityItem[];
	schemaColorMap: Map<string, string>;
}) {
	if (items.length === 0) {
		return null;
	}
	return (
		<Box>
			<SectionLabel color={SECTION_ACCENTS.activity} label="Recent Activity" />
			{items.map((item, idx) => {
				const color = schemaColorMap.get(item.entity.entitySchemaSlug) ?? FALLBACK_COLOR;
				const isLast = idx === items.length - 1;
				return (
					<Box key={item.id} className="flex-row">
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
						<Box className={clsx("flex-1 pl-3", isLast ? "pb-2" : "pb-4")}>
							<Box className="flex-row items-baseline gap-2">
								<Text
									className="flex-1 text-[15px] font-sans-medium text-foreground web:text-[17px]"
									numberOfLines={1}
								>
									{item.entity.name}
								</Text>
								<Text className="text-xs font-mono text-stone-400 web:text-[14px]">
									{timeAgo(item.occurredAt)}
								</Text>
							</Box>
							<Box className="mt-0.5 flex-row items-center gap-1.5">
								<Text className="text-[13px] font-sans-medium web:text-[15px]" style={{ color }}>
									{activityLabel(item.eventSchemaSlug, item.rating)}
								</Text>
								<Box
									className="rounded px-1 py-px"
									style={{ backgroundColor: hexToRgba(color, 0.12) }}
								>
									<Text
										className="text-[10px] font-sans-medium uppercase tracking-[0.5px] web:text-xs"
										style={{ color }}
									>
										{item.entity.entitySchemaSlug}
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
