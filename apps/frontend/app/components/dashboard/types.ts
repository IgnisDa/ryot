import type {
	UserCollectionsListQuery,
	UserMetadataDetailsQuery,
} from "@ryot/generated/graphql/backend/graphql";
import type { FC, ReactNode } from "react";
import type { ThreePointSmileyRating } from "~/lib/common";

export enum WatchTimes {
	JustCompletedNow = "Just Completed Now",
	IDontRemember = "I don't remember",
	CustomDate = "Custom Date",
	JustStartedIt = "Just Started It",
}

export interface LinksGroupProps {
	// biome-ignore lint/suspicious/noExplicitAny: required here
	icon: FC<any>;
	label: string;
	href?: string;
	opened: boolean;
	toggle: () => void;
	tourControlTarget?: string;
	setOpened: (v: boolean) => void;
	links?: Array<{ label: string; link: string; tourControlTarget?: string }>;
}

export type Collection =
	UserCollectionsListQuery["userCollectionsList"]["response"][number];

export type InProgress =
	UserMetadataDetailsQuery["userMetadataDetails"]["inProgress"];
export type History =
	UserMetadataDetailsQuery["userMetadataDetails"]["history"];

export interface SmileySurroundProps {
	children: ReactNode;
	smileyRating: ThreePointSmileyRating;
}
