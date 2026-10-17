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
import { entityHref } from "@/lib/navigation-data";

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

export function StatPill(props: { color: string; label: string }) {
	return (
		<Box
			className="rounded-full px-2.5 py-1"
			style={{ backgroundColor: hexToRgba(props.color, 0.12) }}
		>
			<Text className="text-[13px] font-sans-medium web:text-[15px]" style={{ color: props.color }}>
				{props.label}
			</Text>
		</Box>
	);
}

export function StatCard(props: { color: string; count: number; label: string }) {
	return (
		<Box
			className="min-w-[110] rounded-xl px-4 py-3"
			style={{
				borderWidth: 1,
				borderColor: hexToRgba(props.color, 0.18),
				backgroundColor: hexToRgba(props.color, 0.09),
			}}
		>
			<Text
				style={{ color: props.color }}
				className="text-[34px] font-heading-semibold leading-[36px] web:text-[40px] web:leading-[44px]"
			>
				{props.count}
			</Text>
			<Text className="mt-0.5 text-xs font-sans-medium uppercase tracking-[1px] text-muted-foreground web:text-[14px]">
				{props.label}
			</Text>
		</Box>
	);
}

function SectionLabel(props: { color: string; label: string }) {
	return (
		<Box className="mb-4 mt-8 flex-row items-center gap-3">
			<Box className="h-px flex-1" style={{ backgroundColor: hexToRgba(props.color, 0.35) }} />
			<Text
				style={{ color: props.color }}
				className="text-xs font-sans-semibold uppercase tracking-[2px] web:text-[14px]"
			>
				{props.label}
			</Text>
			<Box className="h-px flex-1" style={{ backgroundColor: hexToRgba(props.color, 0.35) }} />
		</Box>
	);
}

function StarRating(props: { rating: number; onChange: (r: number) => void }) {
	const gold = SECTION_ACCENTS.continue;
	return (
		<Box className="flex-row gap-1.5">
			{[1, 2, 3, 4, 5].map((i) => (
				<Pressable key={i} onPress={() => props.onChange(i === props.rating ? 0 : i)} hitSlop={8}>
					<Star
						size={20}
						strokeWidth={1.5}
						color={i <= props.rating ? gold : "#a8a29e"}
						fill={i <= props.rating ? gold : "transparent"}
					/>
				</Pressable>
			))}
		</Box>
	);
}

function StoryRing(props: {
	color: string;
	large?: boolean;
	xlarge?: boolean;
	item: ContinueItem;
	imageUrl: string | undefined;
}) {
	const { item, color, large, xlarge, imageUrl } = props;
	const { gap, size, stroke } = xlarge ? RING_XL : large ? RING_LG : RING_SM;
	const thumbSize = size - stroke * 2 - gap * 2;
	const r = (size - stroke) / 2;
	const circ = 2 * Math.PI * r;
	const progressPercent = item.progress.progressPercent ?? 0;
	const dashOffset = circ * (1 - progressPercent / 100);
	const ringWidth = size + 8;

	return (
		<Pressable className="items-center" style={{ width: ringWidth }}>
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
					className="overflow-hidden rounded-full"
					style={{
						width: thumbSize,
						top: stroke + gap,
						height: thumbSize,
						left: stroke + gap,
						position: "absolute",
						backgroundColor: hexToRgba(color, 0.18),
					}}
				>
					{imageUrl ? (
						<Image resizeMode="cover" source={{ uri: imageUrl }} className="h-full w-full" />
					) : (
						<Box className="flex-1 items-center justify-center">
							<Text
								style={{ color }}
								numberOfLines={3}
								className="text-center text-[7px] font-sans-medium uppercase"
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
				className="mt-1 text-center text-xs font-sans text-muted-foreground web:text-[14px]"
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

export function StoryRingRow(props: {
	wrap?: boolean;
	large?: boolean;
	wrapGap?: number;
	xlarge?: boolean;
	items: ContinueItem[];
	schemaColorMap: Map<string, string>;
	imageUrls: Map<string, string | undefined>;
}) {
	const { items, large, wrap, xlarge, wrapGap, imageUrls, schemaColorMap } = props;
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

export function UpNextSection(props: {
	items: UpNextItem[];
	schemaColorMap: Map<string, string>;
	imageUrls: Map<string, string | undefined>;
}) {
	const { items, imageUrls, schemaColorMap } = props;
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
							onPress={() => router.push(entityHref(item.id))}
						>
							<Box
								style={{ backgroundColor: hexToRgba(color, 0.13) }}
								className="aspect-2/3 overflow-hidden rounded-[10px] sm:max-h-60"
							>
								{imageUrl ? (
									<Image source={{ uri: imageUrl }} className="flex-1" resizeMode="cover" />
								) : (
									<Box className="flex-1 items-center justify-center px-3">
										<Text
											style={{ color }}
											numberOfLines={4}
											className="text-center text-xs font-sans-medium uppercase tracking-[1px] web:text-[14px]"
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
								<Text className="text-xs font-sans text-muted-foreground web:text-[14px]">
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

function RateCard(props: {
	color: string;
	item: RateItem;
	onNext: () => void;
	imageUrl: string | undefined;
}) {
	const { item, color, onNext, imageUrl } = props;
	const router = useRouter();
	const [rating, setRating] = useState(0);
	const gradientColors: [string, string] = ["transparent", "rgba(0,0,0,0.55)"];

	return (
		<Box
			style={{ borderColor: hexToRgba(color, 0.18) }}
			className="overflow-hidden rounded-[14px] border border-white bg-white"
		>
			<Pressable
				className="h-[210] sm:h-[240] md:h-[270] lg:h-[300]"
				style={{ backgroundColor: hexToRgba(color, 0.13) }}
				onPress={() => router.push(entityHref(item.id))}
			>
				<ImageBackground
					className="flex-1"
					resizeMode="cover"
					source={imageUrl ? { uri: imageUrl } : undefined}
				>
					<LinearGradient
						locations={[0.5, 1]}
						colors={gradientColors}
						style={{ bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }}
					/>
					<Box className="absolute bottom-3.5 left-3.5 right-3.5">
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
							numberOfLines={2}
							className="text-[18px] leading-5.5 font-heading-semibold text-white"
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

export function RateTheseSection(props: {
	items: RateItem[];
	schemaColorMap: Map<string, string>;
	imageUrls: Map<string, string | undefined>;
}) {
	const { items, imageUrls, schemaColorMap } = props;
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
				<Box className="pb-2.5">
					{idx + 1 < items.length ? (
						<Box
							className="absolute bottom-0 left-3 right-3 top-2.5 rounded-[14px] border"
							style={{
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

export function ActivitySection(props: {
	items: ActivityItem[];
	schemaColorMap: Map<string, string>;
}) {
	const { items, schemaColorMap } = props;
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
						onPress={() => router.push(entityHref(item.entityId))}
					>
						<Box className="items-center pt-1 w-5">
							<Box className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
							{!isLast ? (
								<Box
									className="mt-1 w-px flex-1"
									style={{ backgroundColor: hexToRgba(color, 0.2) }}
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
								<Text className="text-xs font-sans text-stone-400 web:text-[14px]">
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
