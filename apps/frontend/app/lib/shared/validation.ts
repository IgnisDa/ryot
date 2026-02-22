import type { MediaCollectionFilter } from "@ryot/generated/graphql/backend/graphql";
import { isEqual, isString } from "@ryot/ts-utils";
import { createParser } from "nuqs";
import { z } from "zod";
import { convertTimestampToUtcString } from "./date-utils";

export const zodCommaDelimitedString = z
	.string()
	.optional()
	.transform((v) => (isString(v) ? v.split(",") : undefined));

export const zodDateTimeString = z
	.string()
	.transform((v) => convertTimestampToUtcString(v));

export const passwordConfirmationSchema = z
	.object({
		confirm: z.string(),
		password: z
			.string()
			.min(8, "Password should be at least 8 characters long"),
	})
	.refine((data) => data.password === data.confirm, {
		error: "Passwords do not match",
		path: ["confirm"],
	});

export const parseAsCollectionsFilter = createParser<MediaCollectionFilter[]>({
	eq: (a, b) => isEqual(a, b),
	serialize: (value) =>
		value.map((v) => `${v.collectionId}|${v.presence}|${v.strategy}`).join(","),
	parse: (value) =>
		value.split(",").map((v) => {
			const [collectionId, presence, strategy] = v.split("|");
			if (!collectionId || !presence || !strategy)
				throw new Error("Invalid collection filter format");
			return { presence, strategy, collectionId } as MediaCollectionFilter;
		}),
});
