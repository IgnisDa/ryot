import clsx from "clsx";
import { LinearGradient } from "expo-linear-gradient";
import { Star } from "lucide-react-native";
import { useState } from "react";
import { ImageBackground, ScrollView } from "react-native";

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
	imageUri: string | null;
	entitySchemaSlug: string;
	labels: { cta: string; progress: string };
	progress: { currentUnits: number; progressPercent: number; totalUnits: number };
	title: string;
};

export type UpNextItem = {
	id: string;
	imageUri: string | null;
	entitySchemaSlug: string;
	labels: { cta: string };
	subtitle: { label: string | null; raw: number | null };
	title: string;
};

export type RateItem = {
	id: string;
	completedAt: Date;
	imageUri: string | null;
	entitySchemaSlug: string;
	rating: number | null;
	title: string;
};

export type ActivityItem = {
	id: string;
	entityId: string;
	entitySchemaSlug: string;
	entityName: string;
	eventSchemaSlug: string;
	imageUri: string | null;
	occurredAt: Date;
	rating: number | null;
};

// ─── Primitive components ─────────────────────────────────────────────────────

export function StatPill({ color, label }: { color: string; label: string }) {
	return (
		<Box className="rounded-full px-2.5 py-1" style={{ backgroundColor: hexToRgba(color, 0.12) }}>
			<Text className="text-[11px] font-sans-medium" style={{ color }}>
				{label}
			</Text>
		</Box>
	);
}

function ProgressBar({
	color,
	pct,
	trackColor,
}: {
	color: string;
	pct: number;
	trackColor: string;
}) {
	return (
		<Box className="absolute bottom-0 left-0 right-0 h-[3px] flex-row">
			<Box style={{ backgroundColor: color, flex: pct }} />
			<Box style={{ backgroundColor: trackColor, flex: 100 - pct }} />
		</Box>
	);
}

function FeedSectionLabel({ color, label }: { color: string; label: string }) {
	return (
		<Box className="mb-3 mt-7 flex-row items-center gap-2">
			<Box className="h-[2px] w-4 rounded-full" style={{ backgroundColor: color }} />
			<Text className="text-[10px] font-sans-medium uppercase tracking-[2px]" style={{ color }}>
				{label}
			</Text>
		</Box>
	);
}

function StarRating({ initialRating = 0 }: { initialRating?: number }) {
	const [rating, setRating] = useState(initialRating);
	const gold = SECTION_ACCENTS.continue;
	return (
		<Box className="flex-row gap-1">
			{[1, 2, 3, 4, 5].map((i) => (
				<Pressable key={i} onPress={() => setRating(i === rating ? 0 : i)} hitSlop={8}>
					<Star
						fill={i <= rating ? gold : "transparent"}
						color={i <= rating ? gold : "#a8a29e"}
						size={16}
						strokeWidth={1.5}
					/>
				</Pressable>
			))}
		</Box>
	);
}

// ─── Hero card ────────────────────────────────────────────────────────────────

export function HeroCard({ item }: { item: ContinueItem }) {
	const color = schemaColor(item.entitySchemaSlug);
	const gradientColors: [string, string] = ["transparent", "rgba(0,0,0,0.88)"];

	return (
		<Pressable>
			<Box style={{ borderRadius: 12, height: 285, overflow: "hidden" }}>
				<ImageBackground
					source={item.imageUri ? { uri: item.imageUri } : undefined}
					resizeMode="cover"
					style={{ flex: 1, backgroundColor: hexToRgba(color, 0.22) }}
				>
					<LinearGradient
						colors={gradientColors}
						locations={[0.2, 1]}
						style={{ bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }}
					/>

					{/* Content anchored to bottom */}
					<Box style={{ bottom: 16, left: 20, position: "absolute", right: 20 }}>
						<Box
							className="mb-1.5 self-start rounded px-2 py-0.5"
							style={{ backgroundColor: hexToRgba(color, 0.4) }}
						>
							<Text
								className="text-[9px] font-sans-medium uppercase tracking-[1px]"
								style={{ color }}
							>
								{item.entitySchemaSlug}
							</Text>
						</Box>
						<Box className="flex-row items-end gap-3">
							<Box className="flex-1">
								<Text
									className="font-heading-semibold text-white"
									style={{ fontSize: 22, lineHeight: 27 }}
									numberOfLines={2}
								>
									{item.title}
								</Text>
								<Text
									className="mt-1 text-[12px] font-mono"
									style={{ color: "rgba(255,255,255,0.65)" }}
								>
									{item.labels.progress}
								</Text>
							</Box>
							<Pressable className="rounded-full px-4 py-2" style={{ backgroundColor: color }}>
								<Text className="text-[12px] font-sans-semibold text-white">Continue</Text>
							</Pressable>
						</Box>
					</Box>

					<ProgressBar
						color={color}
						pct={item.progress.progressPercent}
						trackColor="rgba(255,255,255,0.18)"
					/>
				</ImageBackground>
			</Box>
		</Pressable>
	);
}

// ─── In-progress strip (secondary items below hero) ───────────────────────────

export function InProgressStrip({ items }: { items: ContinueItem[] }) {
	if (items.length === 0) {
		return null;
	}
	return (
		<ScrollView
			horizontal
			showsHorizontalScrollIndicator={false}
			className="mt-3"
			contentContainerStyle={{ gap: 10 }}
		>
			{items.map((item) => {
				const color = schemaColor(item.entitySchemaSlug);
				return (
					<Pressable key={item.id}>
						<Box style={{ borderRadius: 8, height: 90, overflow: "hidden", width: 60 }}>
							<ImageBackground
								source={item.imageUri ? { uri: item.imageUri } : undefined}
								resizeMode="cover"
								style={{ flex: 1, backgroundColor: hexToRgba(color, 0.18) }}
							>
								{!item.imageUri && (
									<Box className="flex-1 items-center justify-center px-1">
										<Text
											className="text-center text-[8px] font-sans-medium uppercase"
											style={{ color }}
											numberOfLines={4}
										>
											{item.title}
										</Text>
									</Box>
								)}
								<ProgressBar
									color={color}
									pct={item.progress.progressPercent}
									trackColor="rgba(0,0,0,0.3)"
								/>
							</ImageBackground>
						</Box>
						<Text
							className="mt-1 text-[9px] font-sans-medium text-foreground"
							style={{ width: 60 }}
							numberOfLines={2}
						>
							{item.title}
						</Text>
					</Pressable>
				);
			})}
		</ScrollView>
	);
}

// ─── Up Next ──────────────────────────────────────────────────────────────────

export function UpNextSection({ items }: { items: UpNextItem[] }) {
	return (
		<Box>
			<FeedSectionLabel color={SECTION_ACCENTS.upNext} label="Up Next" />
			{items.map((item, idx) => {
				const color = schemaColor(item.entitySchemaSlug);
				return (
					<Pressable key={item.id}>
						<Box
							className={clsx(
								"flex-row items-center gap-3 py-2.5",
								idx < items.length - 1 && "border-b border-border",
							)}
						>
							<Box className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
							<Text
								className="flex-1 text-[14px] font-sans-medium text-foreground"
								numberOfLines={1}
							>
								{item.title}
							</Text>
							<Box className="flex-row items-center gap-1.5">
								{item.subtitle.label ? (
									<Text className="text-[11px] font-mono text-muted-foreground">
										{item.subtitle.label}
									</Text>
								) : null}
								<Box
									className="rounded px-1.5 py-0.5"
									style={{ backgroundColor: hexToRgba(color, 0.12) }}
								>
									<Text
										className="text-[9px] font-sans-medium uppercase tracking-[0.5px]"
										style={{ color }}
									>
										{item.entitySchemaSlug}
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

// ─── Rate These ───────────────────────────────────────────────────────────────

export function RateTheseSection({ items }: { items: RateItem[] }) {
	return (
		<Box>
			<FeedSectionLabel color={SECTION_ACCENTS.rateThese} label="Rate These" />
			{items.map((item, idx) => {
				const color = schemaColor(item.entitySchemaSlug);
				return (
					<Box
						key={item.id}
						className={clsx(
							"flex-row items-center gap-3 py-3",
							idx < items.length - 1 && "border-b border-border",
						)}
					>
						<Box
							style={{
								backgroundColor: hexToRgba(color, 0.14),
								borderRadius: 6,
								height: 66,
								overflow: "hidden",
								width: 44,
							}}
						>
							<ImageBackground
								source={item.imageUri ? { uri: item.imageUri } : undefined}
								resizeMode="cover"
								style={{ flex: 1 }}
							/>
						</Box>
						<Box className="flex-1">
							<Box className="mb-1.5 flex-row items-center gap-2">
								<Text
									className="flex-1 text-[13px] font-sans-medium text-foreground"
									numberOfLines={1}
								>
									{item.title}
								</Text>
								<Box
									className="rounded px-1 py-0.5"
									style={{ backgroundColor: hexToRgba(color, 0.14) }}
								>
									<Text
										className="text-[9px] font-sans-medium uppercase tracking-[0.5px]"
										style={{ color }}
									>
										{item.entitySchemaSlug}
									</Text>
								</Box>
							</Box>
							<StarRating initialRating={item.rating ?? 0} />
						</Box>
					</Box>
				);
			})}
		</Box>
	);
}

// ─── Activity timeline ────────────────────────────────────────────────────────

export function ActivitySection({ items }: { items: ActivityItem[] }) {
	return (
		<Box>
			<FeedSectionLabel color={SECTION_ACCENTS.activity} label="Recent Activity" />
			{items.map((item, idx) => {
				const color = schemaColor(item.entitySchemaSlug);
				const isLast = idx === items.length - 1;
				return (
					<Box key={item.id} className="flex-row">
						{/* Timeline spine */}
						<Box className="items-center" style={{ paddingTop: 3, width: 18 }}>
							<Box style={{ backgroundColor: color, borderRadius: 4, height: 8, width: 8 }} />
							{!isLast && (
								<Box
									className="flex-1"
									style={{
										backgroundColor: hexToRgba(color, 0.22),
										marginTop: 3,
										width: 1,
									}}
								/>
							)}
						</Box>

						{/* Content */}
						<Box className={clsx("flex-1 pl-3", !isLast ? "pb-4" : "pb-1")}>
							<Box className="flex-row items-center gap-2">
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
							<Text className="text-[11px] font-sans-medium" style={{ color }}>
								{activityLabel(item.eventSchemaSlug, item.rating)}
							</Text>
						</Box>
					</Box>
				);
			})}
		</Box>
	);
}
