export type SaveDownloadOutcome =
	| { readonly kind: "saved" }
	| { readonly kind: "failed"; readonly message: string };

export type SaveDownloadInput = {
	readonly url: string;
	readonly fileName: string;
	readonly contentType: string;
	readonly headers: () => Promise<Record<string, string>>;
};
