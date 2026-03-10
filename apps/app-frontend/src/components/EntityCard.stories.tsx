import type React from "react";
import preview from "#.storybook/preview";
import { EntityCard } from "./EntityCard";

const meta = preview.meta({
	title: "Components/EntityCard",
	component: EntityCard as React.ComponentType,
});

export const WithImage = meta.story({
	args: {
		name: "The Shawshank Redemption",
		schemaName: "Movie",
		lastEvent: "Watched 2 days ago",
		image:
			"https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&auto=format",
		rating: "9.5",
		isDark: false,
		facetColor: { base: "#5B7FFF", muted: "rgba(91, 127, 255, 0.12)" },
	},
});

export const WithoutImage = meta.story({
	args: {
		name: "Daily Workout",
		schemaName: "Exercise",
		lastEvent: "Completed today",
		isDark: false,
		facetColor: { base: "#2DD4BF", muted: "rgba(45, 212, 191, 0.12)" },
	},
});

export const WithoutRating = meta.story({
	args: {
		name: "Central Park",
		schemaName: "Place",
		lastEvent: "Visited last week",
		image:
			"https://images.unsplash.com/photo-1568515387631-8b650bbcdb90?w=400&auto=format",
		isDark: false,
		facetColor: { base: "#A78BFA", muted: "rgba(167, 139, 250, 0.12)" },
	},
});

export const GoldAccent = meta.story({
	args: {
		name: "Glenfiddich 18",
		schemaName: "Whiskey",
		lastEvent: "Tasted yesterday",
		image:
			"https://images.unsplash.com/photo-1527281400683-1aae777175f8?w=400&auto=format",
		rating: "8.5",
		isDark: false,
		facetColor: { base: "#D4A574", muted: "rgba(212, 165, 116, 0.12)" },
	},
});

export const Gallery = meta.story({
	render: () => (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "repeat(3, 280px)",
				gap: 16,
			}}
		>
			<EntityCard
				name="The Godfather"
				schemaName="Movie"
				lastEvent="Watched last week"
				image="https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=400&auto=format"
				rating="9.8"
				facetColor={{ base: "#5B7FFF", muted: "rgba(91, 127, 255, 0.12)" }}
			/>
			<EntityCard
				name="Morning Run"
				schemaName="Exercise"
				lastEvent="Completed today"
				facetColor={{ base: "#2DD4BF", muted: "rgba(45, 212, 191, 0.12)" }}
			/>
			<EntityCard
				name="Lagavulin 16"
				schemaName="Whiskey"
				lastEvent="Tasted 3 days ago"
				image="https://images.unsplash.com/photo-1569529465841-dfecdab7503b?w=400&auto=format"
				rating="9.0"
				facetColor={{ base: "#D4A574", muted: "rgba(212, 165, 116, 0.12)" }}
			/>
		</div>
	),
});
