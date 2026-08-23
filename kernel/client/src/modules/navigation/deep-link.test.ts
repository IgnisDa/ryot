import { describe, expect, it } from "vitest";

import {
	createDeepLinkBridge,
	resolveDeepLinkHref,
	type DeepLinkNavigator,
	type NativeAppSource,
} from "#/modules/navigation/deep-link";

type Recorded = { readonly href: string; readonly replace: boolean };

const makeHarness = (launchUrl: string | null = null) => {
	let exited = 0;
	let backCount = 0;
	let dismissed = 0;
	let canGoBack = false;
	let overlayOpen = false;
	const removed: Array<string> = [];
	const navigated: Array<Recorded> = [];
	let backButton: (() => void) | undefined;
	let urlOpen: ((url: string) => void) | undefined;

	const source: NativeAppSource = {
		exitApp: () => {
			exited += 1;
		},
		getLaunchUrl: () => Promise.resolve(launchUrl),
		onUrlOpen: (handler) => {
			urlOpen = handler;
			return Promise.resolve(() => removed.push("appUrlOpen"));
		},
		onBackButton: (handler) => {
			backButton = handler;
			return Promise.resolve(() => removed.push("backButton"));
		},
	};

	const navigator: DeepLinkNavigator = {
		canGoBack: () => canGoBack,
		back: () => {
			backCount += 1;
		},
		navigate: (href, options) => {
			navigated.push({ href, replace: options.replace });
		},
		dismissOverlay: () => {
			if (!overlayOpen) {
				return false;
			}
			overlayOpen = false;
			dismissed += 1;
			return true;
		},
	};

	return {
		source,
		removed,
		navigator,
		navigated,
		pressBack: () => backButton?.(),
		openUrl: (url: string) => urlOpen?.(url),
		allowBack: () => {
			canGoBack = true;
		},
		openOverlay: () => {
			overlayOpen = true;
		},
		counts: () => ({ exited, backCount, dismissed }),
	};
};

describe("resolveDeepLinkHref", () => {
	it("folds the authority of a custom-scheme link back into the path", () => {
		expect(resolveDeepLinkHref("io.ryot.app://e/entity123")).toBe("/e/entity123");
		expect(resolveDeepLinkHref("io.ryot.app.dev://settings/account")).toBe("/settings/account");
	});

	it("keeps the search string", () => {
		expect(resolveDeepLinkHref("io.ryot.app://v/all-shows?page=2")).toBe("/v/all-shows?page=2");
	});

	it("resolves an authority-less custom-scheme link", () => {
		expect(resolveDeepLinkHref("io.ryot.app:/settings")).toBe("/settings");
		expect(resolveDeepLinkHref("io.ryot.app:")).toBe("/");
	});

	it("accepts the bundle identifier schemes of both build variants", () => {
		expect(resolveDeepLinkHref("io.ryot.app://media")).toBe("/media");
		expect(resolveDeepLinkHref("io.ryot.app.dev://media")).toBe("/media");
	});

	it("preserves authority-free OAuth callback queries", () => {
		expect(resolveDeepLinkHref("io.ryot.app:/auth/callback?code=code-1&state=state-1")).toBe(
			"/auth/callback?code=code-1&state=state-1",
		);
		expect(
			resolveDeepLinkHref("io.ryot.app.dev:/auth/callback?error=access_denied&state=state-2"),
		).toBe("/auth/callback?error=access_denied&state=state-2");
	});

	it("uses the path of an http or https link", () => {
		expect(resolveDeepLinkHref("https://ryot.io/fitness/workouts/123")).toBe(
			"/fitness/workouts/123",
		);
	});

	it("rejects an unknown scheme or an unparseable value", () => {
		expect(resolveDeepLinkHref("ryot://media")).toBeNull();
		expect(resolveDeepLinkHref("other://media")).toBeNull();
		expect(resolveDeepLinkHref("not a url")).toBeNull();
		expect(resolveDeepLinkHref("")).toBeNull();
	});
});

describe("createDeepLinkBridge", () => {
	it("replaces the current entry for a launch URL and pushes for a later one", async () => {
		const harness = makeHarness("io.ryot.app://e/entity123");
		const bridge = createDeepLinkBridge(harness.source, harness.navigator);
		await Promise.resolve();

		harness.openUrl("io.ryot.app.dev://media/search");
		bridge.destroy();

		expect(harness.navigated).toEqual([
			{ replace: true, href: "/e/entity123" },
			{ replace: false, href: "/media/search" },
		]);
	});

	it("ignores a link that does not resolve to an application route", async () => {
		const harness = makeHarness();
		const bridge = createDeepLinkBridge(harness.source, harness.navigator);
		await Promise.resolve();

		harness.openUrl("other://media");
		bridge.destroy();

		expect(harness.navigated).toEqual([]);
	});

	it("navigates back while history remains and exits at the root", async () => {
		const harness = makeHarness();
		const bridge = createDeepLinkBridge(harness.source, harness.navigator);
		await Promise.resolve();

		harness.allowBack();
		harness.pressBack();
		expect(harness.counts()).toEqual({ exited: 0, backCount: 1, dismissed: 0 });

		bridge.destroy();
	});

	it("dismisses an open overlay before it pops history", async () => {
		const harness = makeHarness();
		const bridge = createDeepLinkBridge(harness.source, harness.navigator);
		await Promise.resolve();

		harness.allowBack();
		harness.openOverlay();
		harness.pressBack();
		expect(harness.counts()).toEqual({ exited: 0, backCount: 0, dismissed: 1 });

		harness.pressBack();
		expect(harness.counts()).toEqual({ exited: 0, backCount: 1, dismissed: 1 });

		bridge.destroy();
	});

	it("exits the application when there is nothing to go back to", async () => {
		const harness = makeHarness();
		const bridge = createDeepLinkBridge(harness.source, harness.navigator);
		await Promise.resolve();

		harness.pressBack();
		bridge.destroy();

		expect(harness.counts()).toEqual({ exited: 1, backCount: 0, dismissed: 0 });
	});

	it("removes every listener once and ignores events after disposal", async () => {
		const harness = makeHarness();
		const bridge = createDeepLinkBridge(harness.source, harness.navigator);
		await Promise.resolve();

		bridge.destroy();
		bridge.destroy();
		harness.openUrl("io.ryot.app://media");
		harness.pressBack();

		expect(harness.removed).toEqual(["appUrlOpen", "backButton"]);
		expect(harness.navigated).toEqual([]);
		expect(harness.counts()).toEqual({ exited: 0, backCount: 0, dismissed: 0 });
	});
});
