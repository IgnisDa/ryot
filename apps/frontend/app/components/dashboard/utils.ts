import { match } from "ts-pattern";
import { ThreePointSmileyRating } from "~/lib/common";

export const convertThreePointSmileyToDecimal = (
	rating: ThreePointSmileyRating,
) =>
	match(rating)
		.with(ThreePointSmileyRating.Happy, () => 100)
		.with(ThreePointSmileyRating.Neutral, () => 66.66)
		.with(ThreePointSmileyRating.Sad, () => 33.33)
		.exhaustive();

export const discordLink = "https://discord.gg/D9XTg2a7R8";
export const desktopSidebarCollapsedCookie = "DesktopSidebarCollapsed";
