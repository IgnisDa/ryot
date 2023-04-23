import { MetadataLot } from "@trackona/generated/graphql/backend/graphql";
import { match } from "ts-pattern";

/**
 * Generate initials for a given string.
 */
export const getInitials = (name: string) => {
	const rgx = new RegExp(/(\p{L}{1})\p{L}+/, "gu");
	const initials = [...name.matchAll(rgx)] || [];
	const actuals = (
		(initials.shift()?.[1] || "") + (initials.pop()?.[1] || "")
	).toUpperCase();
	return actuals;
};

/**
 * Get the correct name of the lot from a string
 */
export const getLot = (lot: unknown) => {
	if (!lot) return undefined;
	const newLot = (lot as string).toLowerCase();
	return match(newLot)
		.with("books", () => MetadataLot.Book)
		.with("movies", () => MetadataLot.Movie)
		.with("games", () => MetadataLot.VideoGame)
		.with("tv", () => MetadataLot.Show)
		.with("audiobooks", () => MetadataLot.AudioBook)
		.otherwise(() => undefined);
};

export enum Verb {
	Read = 0,
}

export const getVerb = (verb: Verb, lot: MetadataLot) => {
	return match(verb)
		.with(Verb.Read, () => {
			return match(lot)
				.with(MetadataLot.Book, () => "read")
				.with(MetadataLot.Movie, () => "watch")
				.otherwise(() => {
					return "";
				});
		})
		.otherwise(() => "");
};
