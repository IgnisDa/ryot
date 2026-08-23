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
	let canGoBack = false;
	const removed: Array<string> = [];
	const navigated: Array<Recorded> = [];
	let backButton: (() => void) | undefined;
	let urlOpen: ((url: string) => void) | undefined;

	const source: NativeAppSource = {
		getLaunchUrl: () => Promise.resolve(launchUrl),
		exitApp: () => {
			exited += 1;
		},
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
	};

	return {
		source,
		removed,
		navigator,
		navigated,
		pressBack: () => backButton?.(),
		counts: () => ({ exited, backCount }),
		openUrl: (url: string) => urlOpen?.(url),
		allowBack: () => {
			canGoBack = true;
		},
	};
};

describe("resolveDeepLinkHref", () => {
	it("folds the authority of a custom-scheme link back into the path", () => {
		expect(resolveDeepLinkHref("ryot://e/entity123")).toBe("/e/entity123");
		expect(resolveDeepLinkHref("ryot://settings/account")).toBe("/settings/account");
	});

	it("keeps the search string", () => {
		expect(resolveDeepLinkHref("ryot://v/all-shows?page=2")).toBe("/v/all-shows?page=2");
	});

	it("resolves an authority-less custom-scheme link", () => {
		expect(resolveDeepLinkHref("ryot:///settings")).toBe("/settings");
		expect(resolveDeepLinkHref("ryot://")).toBe("/");
	});

	it("accepts the bundle identifier schemes of both build variants", () => {
		expect(resolveDeepLinkHref("io.ryot.app://media")).toBe("/media");
		expect(resolveDeepLinkHref("io.ryot.app.dev://media")).toBe("/media");
	});

	it("uses the path of an http or https link", () => {
		expect(resolveDeepLinkHref("https://ryot.io/fitness/workouts/123")).toBe(
			"/fitness/workouts/123",
		);
	});

	it("rejects an unknown scheme or an unparseable value", () => {
		expect(resolveDeepLinkHref("other://media")).toBeNull();
		expect(resolveDeepLinkHref("not a url")).toBeNull();
		expect(resolveDeepLinkHref("")).toBeNull();
	});
});

describe("createDeepLinkBridge", () => {
	it("replaces the current entry for a launch URL and pushes for a later one", async () => {
		const harness = makeHarness("ryot://e/entity123");
		const bridge = createDeepLinkBridge(harness.source, harness.navigator);
		await Promise.resolve();

		harness.openUrl("ryot://media/search");
		bridge.destroy();

		expect(harness.navigated).toEqual([
			{ href: "/e/entity123", replace: true },
			{ href: "/media/search", replace: false },
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
		expect(harness.counts()).toEqual({ exited: 0, backCount: 1 });

		bridge.destroy();
	});

	it("exits the application when there is nothing to go back to", async () => {
		const harness = makeHarness();
		const bridge = createDeepLinkBridge(harness.source, harness.navigator);
		await Promise.resolve();

		harness.pressBack();
		bridge.destroy();

		expect(harness.counts()).toEqual({ exited: 1, backCount: 0 });
	});

	it("removes every listener once and ignores events after disposal", async () => {
		const harness = makeHarness();
		const bridge = createDeepLinkBridge(harness.source, harness.navigator);
		await Promise.resolve();

		bridge.destroy();
		bridge.destroy();
		harness.openUrl("ryot://media");
		harness.pressBack();

		expect(harness.removed).toEqual(["appUrlOpen", "backButton"]);
		expect(harness.navigated).toEqual([]);
		expect(harness.counts()).toEqual({ exited: 0, backCount: 0 });
	});
});
