import { Avatar, Style } from "@dicebear/core";
import bigEars from "@dicebear/styles/big-ears.json" with { type: "json" };

const avatarBackgroundColors = [
	"#ff2e63",
	"#00c2a8",
	"#ffb300",
	"#3d5afe",
	"#8e24aa",
	"#00e676",
] as const;

export const generateUserAvatar = (seed: string): string => {
	const avatar = new Avatar(new Style(bigEars), {
		seed,
		backgroundColor: avatarBackgroundColors,
	});
	return avatar.toDataUri();
};
