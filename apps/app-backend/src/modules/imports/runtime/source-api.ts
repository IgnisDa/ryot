import type { ImportRunFailureStage } from "../schemas";

type SourceQueryValue = boolean | number | string | undefined;
type SourceRequestHeaders = Record<string, string>;

export class ImportSourceRequestError extends Error {
	readonly context: Record<string, unknown>;

	constructor(input: { context?: Record<string, unknown>; message: string }) {
		super(input.message);
		this.context = input.context ?? {};
		this.name = "ImportSourceRequestError";
	}
}

export type ImportSourceAdapterFailure = {
	message: string;
	itemIndex: number;
	sourceLabel?: string;
	sourceIdentifier?: string;
	stage: ImportRunFailureStage;
	context?: Record<string, unknown>;
};

export type SourceJsonRequestInput = {
	path: string;
	baseUrl: string;
	sourceName: string;
	body?: string | null;
	headers?: SourceRequestHeaders;
	method?: "GET" | "HEAD" | "POST";
	allowInsecureConnections?: boolean;
	query?: Record<string, SourceQueryValue>;
};

const getSourceErrorMessage = (input: { host: string; status?: number; sourceName: string }) => {
	if (input.status === 401 || input.status === 403) {
		return `Authentication failed for ${input.sourceName} at ${input.host}`;
	}
	if (input.status !== undefined) {
		return `${input.sourceName} request to ${input.host} failed with status ${input.status}`;
	}
	return `Failed to reach ${input.sourceName} at ${input.host}`;
};

export const normalizeSourceApiUrl = (value: string): string => {
	const parsed = new URL(value.trim());
	if (!parsed.protocol || !["http:", "https:"].includes(parsed.protocol)) {
		throw new Error("Import source URL must use http or https");
	}
	parsed.hash = "";
	parsed.search = "";
	parsed.password = "";
	parsed.username = "";
	return parsed.toString().replace(/\/+$/, "");
};

export const getSourceApiHost = (value: string): string =>
	new URL(normalizeSourceApiUrl(value)).host;

const buildSourceApiUrl = (input: {
	path: string;
	baseUrl: string;
	query?: Record<string, SourceQueryValue>;
}): URL => {
	const url = new URL(input.path.replace(/^\/+/, ""), `${normalizeSourceApiUrl(input.baseUrl)}/`);
	for (const [key, value] of Object.entries(input.query ?? {})) {
		if (value === undefined) {
			continue;
		}
		url.searchParams.set(key, String(value));
	}
	return url;
};

const getImportSourceFailureContext = (
	error: unknown,
	fallback: Record<string, unknown> = {},
): Record<string, unknown> => {
	if (error instanceof ImportSourceRequestError) {
		return error.context;
	}
	return fallback;
};

export const createImportSourceFailure = (input: {
	host: string;
	error: unknown;
	message: string;
	itemIndex: number;
	sourceLabel?: string;
	sourceIdentifier?: string;
	stage: ImportRunFailureStage;
}): ImportSourceAdapterFailure => ({
	stage: input.stage,
	message: input.message,
	itemIndex: input.itemIndex,
	sourceLabel: input.sourceLabel,
	sourceIdentifier: input.sourceIdentifier,
	context: getImportSourceFailureContext(input.error, { host: input.host }),
});

export const requestSourceJson = async <T>(input: SourceJsonRequestInput): Promise<T> => {
	const host = getSourceApiHost(input.baseUrl);
	const url = buildSourceApiUrl({ path: input.path, query: input.query, baseUrl: input.baseUrl });

	try {
		const response = await fetch(url.toString(), {
			body: input.body,
			method: input.method,
			headers: input.headers,
			...(input.allowInsecureConnections ? { tls: { rejectUnauthorized: false } } : {}),
		});
		if (!response.ok) {
			throw new ImportSourceRequestError({
				context: { host, status: response.status },
				message: getSourceErrorMessage({
					host,
					status: response.status,
					sourceName: input.sourceName,
				}),
			});
		}

		// oxlint-disable-next-line no-unsafe-type-assertion
		return (await response.json()) as T;
	} catch (error) {
		if (error instanceof ImportSourceRequestError) {
			throw error;
		}
		throw new ImportSourceRequestError({
			context: { host },
			message: getSourceErrorMessage({ host, sourceName: input.sourceName }),
		});
	}
};

export const mapWithConcurrency = async <TItem, TResult>(
	items: TItem[],
	concurrency: number,
	mapper: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> => {
	if (items.length === 0) {
		return [];
	}

	const results: TResult[] = [];
	let nextIndex = 0;

	const worker = async () => {
		// oxlint-disable no-await-in-loop
		while (nextIndex < items.length) {
			const currentIndex = nextIndex;
			nextIndex += 1;
			const item = items[currentIndex];
			if (item === undefined) {
				break;
			}
			results[currentIndex] = await mapper(item, currentIndex);
		}
		// oxlint-enable no-await-in-loop
	};

	await Promise.all(
		Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, () => worker()),
	);

	return results;
};
