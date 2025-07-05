import type {
	MediaCollectionFilter,
	MediaCollectionPresenceFilter,
} from "@ryot/generated/graphql/backend/graphql";
import { isString } from "@ryot/ts-utils";
import { z } from "zod";
import { convertTimestampToUtcString } from "./date-utils";

export const zodCommaDelimitedString = z
	.string()
	.optional()
	.transform((v) => (isString(v) ? v.split(",") : undefined));

export const zodEmptyNumberString = z
	.any()
	.transform((v) => (!v ? undefined : Number.parseInt(v)))
	.nullable();

export const zodEmptyDecimalString = z
	.any()
	.transform((v) => (!v ? undefined : Number.parseFloat(v).toString()))
	.nullable();

export const zodCollectionFilter = zodCommaDelimitedString.transform(
	(v) =>
		(v || [])
			.map((s) => {
				const [collectionId, presence] = s.split(":");
				if (!collectionId || !presence) return undefined;
				return {
					collectionId,
					presence: presence as MediaCollectionPresenceFilter,
				};
			})
			.filter(Boolean) as MediaCollectionFilter[],
);

export const zodDateTimeString = z
	.string()
	.transform((v) => convertTimestampToUtcString(v));
