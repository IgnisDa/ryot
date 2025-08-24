import { changeCase } from "@ryot/ts-utils";
import { LinearGradient } from "expo-linear-gradient";
import { Check, Library, Plus } from "lucide-react-native";
import { Image, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";

import { formatMinutes, getPrimaryCreator } from "./sections";
import type { EntityDetail } from "./types";

const ACCENT = "#C9943A";

export function HeroSection({ entity }: { entity: EntityDetail }) {
	const insets = useSafeAreaInsets();
	const { width } = useWindowDimensions();
	const isTablet = width >= 768;

	const firstImage = entity.images[0];
	const imageUrl = firstImage?.kind === "remote" ? firstImage.url : undefined;
	const primaryCreator = getPrimaryCreator(entity);
	const runtime = "runtime" in entity ? entity.runtime : undefined;
	const providerRating = entity.providerRating ?? undefined;

	return (
		<Box className="relative w-full overflow-hidden min-h-100 md:min-h-120">
			{/* Backdrop */}
			{imageUrl ? (
				<Image
					blurRadius={2}
					resizeMode="cover"
					style={{ opacity: 0.45 }}
					source={{ uri: imageUrl }}
					className="absolute inset-0 h-full w-full"
				/>
			) : (
				<Box className="absolute inset-0" style={{ backgroundColor: "rgba(201,148,58,0.12)" }} />
			)}

			{/* Bottom-to-top gradient */}
			<LinearGradient
				colors={["transparent", "rgba(0,0,0,0.5)", "rgba(0,0,0,0.82)"]}
				locations={[0.3, 0.7, 1]}
				style={{ position: "absolute", inset: 0 }}
			/>

			{/* Left-to-right gradient */}
			<LinearGradient
				colors={["rgba(10,10,15,0.85)", "rgba(10,10,15,0.3)", "transparent"]}
				locations={[0, 0.6, 1]}
				start={{ x: 0, y: 0 }}
				end={{ x: 1, y: 0 }}
				style={{ position: "absolute", inset: 0 }}
			/>

			{/* Content */}
			<Box
				style={{ paddingTop: insets.top + (isTablet ? 64 : 40) }}
				className="relative z-10 justify-end pb-6 px-7 md:pb-10 md:px-10 web:mx-auto web:max-w-7xl web:w-full"
			>
				<Box className="flex flex-col items-start gap-5 md:flex-row md:items-end md:gap-10">
					{/* Poster */}
					{imageUrl && (
						<Box
							className="w-35 overflow-hidden rounded-lg md:w-55"
							style={{
								elevation: 20,
								shadowRadius: 50,
								shadowOpacity: 0.5,
								shadowColor: "#000",
								shadowOffset: { width: 0, height: 16 },
							}}
						>
							<Image
								source={{ uri: imageUrl }}
								className="w-full"
								style={{ aspectRatio: 2 / 3 }}
								resizeMode="cover"
							/>
						</Box>
					)}

					{/* Meta */}
					<Box className="min-w-0 flex-1">
						{/* Schema slug badge */}
						<Box
							className="mb-2 self-start rounded px-2 py-0.5"
							style={{ backgroundColor: "rgba(201,148,58,0.35)" }}
						>
							<Text
								className="text-[11px] font-sans-semibold uppercase tracking-[1px] web:text-[13px]"
								style={{ color: ACCENT }}
							>
								{changeCase(entity.entitySchemaSlug)}
							</Text>
						</Box>

						{/* Title */}
						<Text
							className="font-heading-semibold leading-tight text-white text-[28px] md:text-[36px] lg:text-[42px]"
							style={{
								textShadowColor: "rgba(0,0,0,0.4)",
								textShadowOffset: { width: 0, height: 2 },
								textShadowRadius: 20,
							}}
							numberOfLines={3}
						>
							{entity.name}
						</Text>

						{/* Tagline */}
						<Box className="mt-3 flex-row flex-wrap items-center gap-3">
							{entity.publishYear && (
								<Text
									className="text-[13px] web:text-[15px]"
									style={{ color: "rgba(255,255,255,0.7)" }}
								>
									{entity.publishYear}
								</Text>
							)}
							{entity.publishYear && runtime && (
								<Text style={{ color: "rgba(255,255,255,0.4)" }}>·</Text>
							)}
							{runtime && (
								<Text
									className="text-[13px] web:text-[15px]"
									style={{ color: "rgba(255,255,255,0.7)" }}
								>
									{formatMinutes(runtime)}
								</Text>
							)}
							{primaryCreator && (
								<>
									<Text style={{ color: "rgba(255,255,255,0.4)" }}>·</Text>
									<Text
										className="text-[13px] web:text-[15px]"
										style={{ color: "rgba(255,255,255,0.7)" }}
									>
										{primaryCreator.name}
									</Text>
								</>
							)}
						</Box>

						{/* Genres */}
						{entity.genres.length > 0 && (
							<Box className="mt-4 flex-row flex-wrap gap-2">
								{entity.genres.map((g) => (
									<Box
										key={g}
										className="rounded-full border px-2.5 py-1"
										style={{
											backgroundColor: "rgba(255,255,255,0.15)",
											borderColor: "rgba(255,255,255,0.1)",
										}}
									>
										<Text
											className="text-[11px] font-sans-medium web:text-[13px]"
											style={{ color: "rgba(255,255,255,0.85)" }}
										>
											{g}
										</Text>
									</Box>
								))}
							</Box>
						)}

						{/* User state */}
						{providerRating && (
							<Box className="mt-5 flex-row flex-wrap items-center gap-6 border-t border-white/12 pt-4">
								<Box className="flex-row items-center gap-2">
									<Check size={16} color="#4ade80" strokeWidth={2} />
									<Text className="text-[13px] font-sans-semibold text-[#4ade80]">Completed</Text>
								</Box>
								<Box className="flex-row items-center gap-2">
									<Box className="flex-row gap-0.75">
										{[1, 2, 3, 4, 5].map((i) => {
											const filled = i <= Math.round(providerRating / 2);
											return (
												<Box
													key={i}
													className="rounded-[3px]"
													style={{
														width: 20,
														height: 24,
														backgroundColor: filled ? ACCENT : "rgba(255,255,255,0.15)",
													}}
												/>
											);
										})}
									</Box>
									<Text className="ml-2 font-heading-semibold text-[22px] text-white">
										{providerRating.toFixed(1)}
									</Text>
								</Box>
							</Box>
						)}

						{/* Actions */}
						<Box className="mt-5 flex-row flex-wrap gap-3">
							<Pressable className="flex-row items-center gap-2 rounded-full bg-[#C9943A] px-4 py-2.5">
								<Plus size={16} color="#1c1917" strokeWidth={2} />
								<Text className="text-[13px] font-sans-semibold text-[#1c1917] web:text-[15px]">
									Log Event
								</Text>
							</Pressable>
							<Pressable
								className="flex-row items-center gap-2 rounded-full border px-4 py-2.5"
								style={{
									borderColor: "rgba(255,255,255,0.2)",
									backgroundColor: "rgba(255,255,255,0.12)",
								}}
							>
								<Library size={16} color="#fff" strokeWidth={2} />
								<Text className="text-[13px] font-sans-semibold text-white web:text-[15px]">
									Add to Collection
								</Text>
							</Pressable>
						</Box>
					</Box>
				</Box>
			</Box>
		</Box>
	);
}
