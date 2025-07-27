import clsx from "clsx";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Star } from "lucide-react-native";
import { useState } from "react";
import { Image, ImageBackground, ScrollView } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";

import { activityLabel, hexToRgba, timeAgo } from "./overview-utils";
import type { ActivityItem, ContinueItem, RateItem, UpNextItem } from "./use-overview-data";

const FALLBACK_COLOR = "#78716c";

export const SECTION_ACCENTS = {
	upNext: "#8E6A4D",
	activity: "#6F8B75",
	continue: "#C9943A",
	rateThese: "#D38D5A",
};

const RING_LG = { gap: 3, size: 96, stroke: 4 };
const RING_XL = { gap: 3, size: 112, stroke: 4 };
const RING_SM = { gap: 2.5, size: 72, stroke: 3.5 };

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
				style={{ color }}
				className="text-[34px] font-heading-semibold leading-[36px] web:text-[40px] web:leading-[44px]"
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
				style={{ color }}
				className="text-xs font-sans-semibold uppercase tracking-[2px] web:text-[14px]"
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
						size={20}
						strokeWidth={1.5}
						color={i <= rating ? gold : "#a8a29e"}
						fill={i <= rating ? gold : "transparent"}
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
	color: string;
	large?: boolean;
	xlarge?: boolean;
	item: ContinueItem;
	imageUrl: string | undefined;
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
						r={r}
						fill="none"
						cx={size / 2}
						cy={size / 2}
						strokeWidth={stroke}
						stroke={hexToRgba(color, 0.18)}
					/>
					<Circle
						r={r}
						fill="none"
						cx={size / 2}
						cy={size / 2}
						stroke={color}
						strokeWidth={stroke}
						strokeLinecap="round"
						strokeDashoffset={dashOffset}
						strokeDasharray={`${circ} ${circ}`}
						transform={`rotate(-90 ${size / 2} ${size / 2})`}
					/>
				</Svg>
				<Box
					style={{
						width: thumbSize,
						top: stroke + gap,
						height: thumbSize,
						left: stroke + gap,
						overflow: "hidden",
						position: "absolute",
						borderRadius: thumbSize / 2,
						backgroundColor: hexToRgba(color, 0.18),
					}}
				>
					{imageUrl ? (
						<Image
							resizeMode="cover"
							source={{ uri: imageUrl }}
							style={{ height: thumbSize, width: thumbSize }}
						/>
					) : (
						<Box className="flex-1 items-center justify-center">
							<Text
								numberOfLines={3}
								style={{ color, fontSize: 7 }}
								className="text-center font-sans-medium uppercase"
							>
								{item.title}
							</Text>
						</Box>
					)}
				</Box>
			</Box>
			<Text
				numberOfLines={1}
				style={{ width: ringWidth }}
				className="mt-1 text-center text-xs font-mono text-muted-foreground web:text-[14px]"
			>
				{item.labels.progress}
			</Text>
			<Text
				numberOfLines={2}
				style={{ width: ringWidth }}
				className="mt-0.5 text-center text-xs font-sans-medium text-foreground web:text-[14px]"
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
	xlarge,
	wrapGap,
	imageUrls,
	schemaColorMap,
}: {
	wrap?: boolean;
	large?: boolean;
	wrapGap?: number;
	xlarge?: boolean;
	items: ContinueItem[];
	schemaColorMap: Map<string, string>;
	imageUrls: Map<string, string | undefined>;
}) {
	if (items.length === 0) {
		return null;
	}
	if (wrap) {
		return (
			<Box className="flex-row flex-wrap" style={{ gap: wrapGap ?? 16 }}>
				{items.map((item) => (
					<StoryRing
						item={item}
						large={large}
						key={item.id}
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
					item={item}
					key={item.id}
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
	schemaColorMap: Map<string, string>;
	imageUrls: Map<string, string | undefined>;
}) {
	const router = useRouter();
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
						<Pressable
							key={item.id}
							className="w-[48%] sm:w-[32%]"
							onPress={() => router.push(`/entity/${item.id}`)}
						>
							<Box
								className="aspect-2/3 sm:max-h-60"
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
										style={{ color }}
										className="text-[10px] font-sans-medium uppercase tracking-[0.5px] web:text-xs"
									>
										{item.entitySchemaSlug}
									</Text>
								</Box>
							</Box>
							<Text
								numberOfLines={2}
								className="mt-1.5 text-[13px] font-sans-medium text-foreground web:text-[15px]"
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
	onNext,
	imageUrl,
}: {
	color: string;
	item: RateItem;
	onNext: () => void;
	imageUrl: string | undefined;
}) {
	const router = useRouter();
	const [cardWidth, setCardWidth] = useState(0);
	const [rating, setRating] = useState(0);
	const posterHeight = cardWidth > 0 ? Math.min(Math.round(cardWidth * 0.65), 300) : 210;
	const gradientColors: [string, string] = ["transparent", "rgba(0,0,0,0.55)"];

	return (
		<Box
			style={{
				borderWidth: 1,
				borderRadius: 14,
				overflow: "hidden",
				backgroundColor: "#ffffff",
				borderColor: hexToRgba(color, 0.18),
			}}
			onLayout={(e) => setCardWidth(e.nativeEvent.layout.width)}
		>
			<Pressable
				onPress={() => router.push(`/entity/${item.id}`)}
				style={{ height: posterHeight, backgroundColor: hexToRgba(color, 0.13) }}
			>
				<ImageBackground
					resizeMode="cover"
					style={{ flex: 1 }}
					source={imageUrl ? { uri: imageUrl } : undefined}
				>
					<LinearGradient
						locations={[0.5, 1]}
						colors={gradientColors}
						style={{ bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }}
					/>
					<Box style={{ bottom: 14, left: 14, position: "absolute", right: 14 }}>
						<Box
							className="mb-1 self-start rounded px-1.5 py-0.5"
							style={{ backgroundColor: hexToRgba(color, 0.38) }}
						>
							<Text
								style={{ color }}
								className="text-[11px] font-sans-medium uppercase tracking-[0.5px] web:text-[13px]"
							>
								{item.entitySchemaSlug}
							</Text>
						</Box>
						<Text
							numberOfLines={2}
							style={{ fontSize: 18, lineHeight: 22 }}
							className="font-heading-semibold text-white"
						>
							{item.title}
						</Text>
					</Box>
				</ImageBackground>
			</Pressable>
			<Box className="px-4 py-4">
				<Text className="mb-3 text-[13px] font-sans text-muted-foreground web:text-[15px]">
					How would you rate this?
				</Text>
				<Box className="flex-row items-center justify-between">
					<StarRating rating={rating} onChange={setRating} />
					<Pressable onPress={onNext} hitSlop={8}>
						<Text
							style={rating > 0 ? { color } : undefined}
							className={clsx(
								"text-sm font-sans-medium web:text-[16px]",
								rating > 0 ? "font-sans-semibold" : "text-muted-foreground",
							)}
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
	schemaColorMap: Map<string, string>;
	imageUrls: Map<string, string | undefined>;
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
								top: 10,
								left: 12,
								right: 12,
								bottom: 0,
								borderWidth: 1,
								borderRadius: 14,
								position: "absolute",
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
						item={items[idx]}
						key={items[idx].id}
						onNext={() => setIdx((i) => i + 1)}
						imageUrl={imageUrls.get(items[idx].id)}
						color={schemaColorMap.get(items[idx].entitySchemaSlug) ?? FALLBACK_COLOR}
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
	const router = useRouter();
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
					<Pressable
						key={item.id}
						className="flex-row"
						onPress={() => router.push(`/entity/${item.entityId}`)}
					>
						<Box className="items-center" style={{ paddingTop: 4, width: 20 }}>
							<Box style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
							{!isLast ? (
								<Box
									className="flex-1"
									style={{ width: 1, marginTop: 4, backgroundColor: hexToRgba(color, 0.2) }}
								/>
							) : null}
						</Box>
						<Box className={clsx("flex-1 pl-3", isLast ? "pb-2" : "pb-4")}>
							<Box className="flex-row items-baseline gap-2">
								<Text
									numberOfLines={1}
									className="flex-1 text-[15px] font-sans-medium text-foreground web:text-[17px]"
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
										style={{ color }}
										className="text-[10px] font-sans-medium uppercase tracking-[0.5px] web:text-xs"
									>
										{item.entity.entitySchemaSlug}
									</Text>
								</Box>
							</Box>
						</Box>
					</Pressable>
				);
			})}
		</Box>
	);
}
