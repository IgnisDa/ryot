export interface ExtractedMetadata {
	title: string;
	year?: string;
	season?: number;
	episode?: number;
	h1Elements: string[];
	episodeTitle?: string;
	documentTitle: string;
	dataAttributes: Record<string, string>;
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
