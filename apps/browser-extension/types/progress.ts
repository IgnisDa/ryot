export interface RawMediaData {
	title: string;
	year?: string;
	runtime?: number;
	domain: string;
	url: string;
	season?: number;
	episode?: number;
	episodeTitle?: string;
	documentTitle: string;
	h1Elements: string[];
	dataAttributes: Record<string, string>;
	currentTime?: number;
	progress?: number;
	timestamp: string;
}

export interface ExtractedMetadata {
	title: string;
	year?: string;
	season?: number;
	episode?: number;
	episodeTitle?: string;
	documentTitle: string;
	h1Elements: string[];
	dataAttributes: Record<string, string>;
}

export interface FinalProgressData {
	identifier: string;
	source: string;
	lot: string;
	currentTime: number;
	progress: number;
	runtime?: number;
	timestamp: string;
}

export interface FormState {
	status: "idle" | "submitting" | "submitted";
	error?: string;
}

export interface ExtendedHTMLVideoElement extends HTMLVideoElement {
	__iframe?: HTMLIFrameElement;
	__isProxy?: boolean;
}
