import type { MetadataLookupQuery } from "@ryot/generated/graphql/backend/graphql";

export type MetadataLookupData = MetadataLookupQuery["metadataLookup"];

export interface ExtractedMetadata {
	title: string;
	year?: string;
	season?: number;
	episode?: number;
	episodeTitle?: string;
	documentTitle: string;
}

export interface RawMediaData extends ExtractedMetadata {
	url: string;
	domain: string;
	runtime?: number;
	progress?: number;
	timestamp: string;
	currentTime?: number;
}

export interface FormState {
	error?: string;
	status: "idle" | "submitting" | "submitted";
}

export interface ExtensionStatus {
	message?: string;
	videoTitle?: string;
	state: "ready" | "lookup_in_progress" | "tracking_active";
}
