export const MESSAGE_TYPES = {
	GET_STATUS: "GET_STATUS",
	METADATA_LOOKUP: "METADATA_LOOKUP",
	SEND_PROGRESS_DATA: "SEND_PROGRESS_DATA",
	GET_CACHED_TITLE: "GET_CACHED_TITLE",
} as const;

export const STORAGE_KEYS = {
	DEBUG_MODE: "local:debug-mode",
	INTEGRATION_URL: "local:integration-url",
	EXTENSION_STATUS: "local:extension-status",
	CURRENT_PAGE_TITLE: "local:current-page-title",
	HAS_FOUND_VIDEO: "local:has-found-video",
} as const;

export const MIN_VIDEO_DURATION_SECONDS = 600;
