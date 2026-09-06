import { OAUTH_NATIVE_APPLICATION_IDS } from "@ryot-app/contract/oauth";
import { type Cause, Context, Effect, Layer } from "effect";

export type NativeAppSource = {
	readonly exitApp: () => void;
	readonly getLaunchUrl: () => Effect.Effect<string | null, Cause.UnknownError>;
	readonly onBackButton: (handler: () => void) => Effect.Effect<() => void, Cause.UnknownError>;
	readonly onUrlOpen: (
		handler: (url: string) => void,
	) => Effect.Effect<() => void, Cause.UnknownError>;
};

export type DeepLinkNavigator = {
	readonly back: () => void;
	readonly canGoBack: () => boolean;
	readonly dismissOverlay: () => boolean;
	readonly navigate: (href: string, options: { readonly replace: boolean }) => void;
};

type DeepLinkClaim = (rawUrl: string) => void;

export const makeDeepLinkClaims = () => {
	const claims = new Map<string, Set<DeepLinkClaim>>();
	return {
		dispatch: (path: string, rawUrl: string) => {
			const handlers = claims.get(path);
			if (handlers === undefined) {
				return false;
			}
			for (const handler of handlers) {
				handler(rawUrl);
			}
			return true;
		},
		claim: (path: string, handler: DeepLinkClaim) => {
			const handlers = claims.get(path) ?? new Set<DeepLinkClaim>();
			const claimed = (rawUrl: string) => handler(rawUrl);
			handlers.add(claimed);
			claims.set(path, handlers);
			return () => {
				handlers.delete(claimed);
				if (handlers.size === 0 && claims.get(path) === handlers) {
					claims.delete(path);
				}
			};
		},
	};
};

export class DeepLinkClaims extends Context.Service<
	DeepLinkClaims,
	ReturnType<typeof makeDeepLinkClaims>
>()("DeepLinkClaims") {
	static readonly layer = Layer.sync(this, makeDeepLinkClaims);
}

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

const deepLinkPath = (href: string) => new URL(href, "https://ryot.invalid").pathname;

export function createDeepLinkBridge(
	source: NativeAppSource,
	navigator: DeepLinkNavigator,
	claims: DeepLinkClaims["Service"],
) {
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
		if (href === null || claims.dispatch(deepLinkPath(href), rawUrl)) {
			return;
		}
		navigator.navigate(href, options);
	};

	Effect.runFork(
		source.onUrlOpen((url) => open(url, { replace: false })).pipe(Effect.map(register)),
	);
	Effect.runFork(
		source
			.onBackButton(() => {
				if (isDisposed) {
					return;
				}
				if (navigator.dismissOverlay()) {
					return;
				}
				if (navigator.canGoBack()) {
					navigator.back();
					return;
				}
				source.exitApp();
			})
			.pipe(Effect.map(register)),
	);
	Effect.runFork(source.getLaunchUrl().pipe(Effect.map((url) => open(url, { replace: true }))));

	return {
		destroy: () => {
			isDisposed = true;
			for (const remove of removers.splice(0)) {
				remove();
			}
		},
	};
}
