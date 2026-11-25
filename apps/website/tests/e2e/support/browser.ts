import { Effect } from "effect";
import { chromium } from "playwright";

import { fromPromise } from "../../../app/server/effect.server";

const turnstile = `
	window.turnstile = {
		render: (_, options) => {
			queueMicrotask(() => options.callback("valid-captcha"));
			return crypto.randomUUID();
		},
		remove() {},
	};
	window.onloadTurnstileCallback?.();
`;

const paddle = `
	window.PaddleBillingV1 = {
		Initialized: false,
		Environment: { set() {} },
		Initialize(options) { this.Initialized = true; this.Update(options); },
		Update(options) { this.options = { ...this.options, ...options }; },
		Checkout: {
			open(options) { document.body.dataset.paddleCheckout = JSON.stringify(options); },
			close() {},
		},
	};
`;

export const openWebsiteBrowser = Effect.fn(function* () {
	const browser = yield* Effect.acquireRelease(
		fromPromise(() => chromium.launch()),
		(browserProcess) => fromPromise(() => browserProcess.close()).pipe(Effect.orDie),
	);
	const page = yield* fromPromise(() => browser.newPage());
	yield* fromPromise(() =>
		page.route("https://**/*", (route) => {
			const url = new URL(route.request().url());
			if (url.hostname === "challenges.cloudflare.com") {
				return route.fulfill({ body: turnstile, contentType: "text/javascript" });
			}
			if (url.hostname === "cdn.paddle.com") {
				return route.fulfill({ body: paddle, contentType: "text/javascript" });
			}
			return route.abort();
		}),
	);
	return page;
});
