import { OAUTH_NATIVE_APPLICATION_IDS } from "@ryot/contract/oauth";

export type NativeAppSource = {
	readonly exitApp: () => void;
	readonly getLaunchUrl: () => Promise<string | null>;
	readonly onBackButton: (handler: () => void) => Promise<() => void>;
	readonly onUrlOpen: (handler: (url: string) => void) => Promise<() => void>;
};

export type DeepLinkNavigator = {
	readonly back: () => void;
	readonly canGoBack: () => boolean;
	readonly navigate: (href: string, options: { readonly replace: boolean }) => void;
};

const isAppScheme = (scheme: string): boolean =>
	OAUTH_NATIVE_APPLICATION_IDS.some((candidate) => candidate === scheme);

export function resolveDeepLinkHref(rawUrl: string): string | null {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return null;
	}

	const scheme = url.protocol.slice(0, -1);
	if (scheme !== "http" && scheme !== "https" && !isAppScheme(scheme)) {
		return null;
	}

	// A custom-scheme link puts the first path segment in the authority, so it has to be
	// folded back into the path.
	const path = isAppScheme(scheme) && url.host ? `/${url.host}${url.pathname}` : url.pathname;
	return `${path === "" ? "/" : path}${url.search}`;
}

export function createDeepLinkBridge(source: NativeAppSource, navigator: DeepLinkNavigator) {
	const removers: Array<() => void> = [];
	let isDisposed = false;

	const register = (remove: () => void) => {
		if (isDisposed) {
			remove();
			return;
		}
		removers.push(remove);
	};

	const open = (rawUrl: string | null, options: { readonly replace: boolean }) => {
		if (isDisposed || rawUrl === null) {
			return;
		}
		const href = resolveDeepLinkHref(rawUrl);
		if (href !== null) {
			navigator.navigate(href, options);
		}
	};

	void source.onUrlOpen((url) => open(url, { replace: false })).then(register);
	void source
		.onBackButton(() => {
			if (isDisposed) {
				return;
			}
			if (navigator.canGoBack()) {
				navigator.back();
				return;
			}
			source.exitApp();
		})
		.then(register);
	void source.getLaunchUrl().then((url) => open(url, { replace: true }));

	return {
		destroy: () => {
			isDisposed = true;
			for (const remove of removers.splice(0)) {
				remove();
			}
		},
	};
}
