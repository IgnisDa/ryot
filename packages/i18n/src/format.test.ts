import { describe, expect, it } from "bun:test";

import { Result } from "effect";

import { type CompiledCatalog, emptyCatalogRegistry, registerCatalog } from "./catalog";
import { compileMessage } from "./compiler/parse";
import { format, formatDisplayText, formatForModel } from "./format";
import { formattersFor } from "./formatters";
import type { MessageParam } from "./message";

const compile = (messages: Readonly<Record<string, string>>): CompiledCatalog =>
	Object.fromEntries(
		Object.entries(messages).map(([key, source]) => [
			key,
			Result.getOrThrow(compileMessage(source)),
		]),
	);

const count = (value: number) => ({
	key: "item.count",
	namespace: "media",
	params: { count: value },
});

const registry = [
	[
		"kernel",
		"en",
		{ "message.loading": "…", "message.unavailable": "This message is no longer available." },
	],
	[
		"media",
		"en",
		{
			"item.greeting": "Hello {name}",
			"item.wrapped": "Note: {inner}",
			"item.only-english": "Only English",
			"item.released": "Released {at, date, ::yMMMd}",
			"item.expires": "Expires {at, date, ::yMMMdjm}",
			"item.airs": "Airs {day, date, calendar-medium}",
			"item.count": "{count, plural, one {# item} other {# items}}",
			"item.status": "{status, select, done {Finished} other {Unknown}}",
			"item.due": "Due {at, date, zoned-medium} at {at, time, zoned-short}",
		},
	],
	[
		"media",
		"pt",
		{
			"item.greeting": "Olá {name}",
			"item.count": "{count, plural, one {# item} other {# itens}}",
		},
	],
	["media", "pt-BR", { "item.greeting": "Oi {name}" }],
	["media", "de", { "item.due": "Fällig am {at, date, zoned-medium} um {at, time, zoned-short}" }],
] as const;

const catalogs = registry.reduce(
	(current, [namespace, locale, messages]) =>
		registerCatalog(current, namespace, locale, compile(messages)),
	emptyCatalogRegistry,
);

const expires = (locale: string) =>
	format(catalogs, locale, {
		namespace: "media",
		key: "item.expires",
		params: { at: { date: "2026-11-15T12:00:00.000Z" } },
	});

const releasedIn = (timeZone: string) =>
	format(
		catalogs,
		"en",
		{
			namespace: "media",
			key: "item.released",
			params: { at: { date: "2026-11-15T20:00:00.000Z" } },
		},
		{ timeZone },
	);

const airs = (day: string, timeZone?: string) =>
	format(catalogs, "en", { params: { day }, key: "item.airs", namespace: "media" }, { timeZone });

const due = (locale: string, at: MessageParam) =>
	format(
		catalogs,
		locale,
		{ params: { at }, key: "item.due", namespace: "media" },
		{ timeZone: "America/Los_Angeles" },
	);

const isPending = (namespace: string) => namespace === "loading";

const portuguese = (message: Parameters<typeof formatForModel>[1]) =>
	format(catalogs, "pt", message);

describe("format", () => {
	it("walks the fallback chain from region to language to English", () => {
		const greeting = { namespace: "media", key: "item.greeting", params: { name: "Ana" } };
		expect<string>(format(catalogs, "pt-BR", greeting)).toBe("Oi Ana");
		expect<string>(format(catalogs, "pt-PT", greeting)).toBe("Olá Ana");
		expect<string>(format(catalogs, "de", greeting)).toBe("Hello Ana");
		expect<string>(
			format(catalogs, "pt-BR", { namespace: "media", key: "item.only-english" }),
		).toBe("Only English");
	});

	it("formats plural, select and date arguments in the requested locale", () => {
		expect<string>(format(catalogs, "en", count(1))).toBe("1 item");
		expect<string>(format(catalogs, "pt-BR", count(1200))).toBe("1.200 itens");
		expect<string>(
			format(catalogs, "en", {
				namespace: "media",
				key: "item.status",
				params: { status: "done" },
			}),
		).toBe("Finished");
		expect<string>(
			format(catalogs, "en", {
				namespace: "media",
				key: "item.released",
				params: { at: { date: "2026-11-15T12:00:00.000Z" } },
			}),
		).toBe("Released Nov 15, 2026");
	});

	it("selects plural categories in the resolving catalog's locale", () => {
		expect<string>(format(catalogs, "fr", count(0))).toBe("0 items");
		expect<string>(format(catalogs, "fr", count(1200))).toBe("1\u202f200 items");
	});

	it("formats dates in the given time zone", () => {
		expect<string>(releasedIn("Asia/Tokyo")).toBe("Released Nov 16, 2026");
		expect<string>(releasedIn("America/Los_Angeles")).toBe("Released Nov 15, 2026");
	});

	it("renders calendar dates on the same day in every time zone", () => {
		expect<string>(airs("2026-11-15", "Pacific/Kiritimati")).toBe("Airs Nov 15, 2026");
		expect<string>(airs("2026-11-15", "Pacific/Pago_Pago")).toBe("Airs Nov 15, 2026");
		expect<string>(airs("2026-11-15")).toBe("Airs Nov 15, 2026");
		expect<string>(airs("2026-02-30")).toBe("This message is no longer available.");
	});

	it("renders zoned date-times in the zone their value carries", () => {
		const date = "2026-11-15T20:30:00.000Z";
		expect<string>(due("en", { date, timeZone: "Asia/Kolkata" })).toMatch(
			/^Due Nov 16, 2026 at 2:00\sAM$/,
		);
		expect<string>(due("de", { date, timeZone: "Europe/Berlin" })).toBe(
			"Fällig am 15. Nov. 2026 um 21:30",
		);
		expect<string>(due("en", { date, timeZone: "Mars/Olympus" })).toBe(
			"This message is no longer available.",
		);
		expect<string>(due("en", { date })).toBe("This message is no longer available.");
	});

	it("renders preferred-hour skeletons in each locale's hour cycle", () => {
		expect<string>(expires("en")).toMatch(/^Expires Nov 15, 2026 at \d{1,2}:\d{2}\s[AP]M$/);
		expect<string>(expires("en-GB")).toMatch(/^Expires 15 Nov 2026 at \d{2}:\d{2}$/);
	});

	it("renders nested messages recursively", () => {
		expect<string>(
			format(catalogs, "pt", {
				namespace: "media",
				key: "item.wrapped",
				params: { inner: { namespace: "media", key: "item.greeting", params: { name: "Rui" } } },
			}),
		).toBe("Note: Olá Rui");
	});

	it("renders the kernel unavailable message for unresolvable messages", () => {
		for (const message of [
			{ key: "item.greeting", namespace: "uninstalled" },
			{ namespace: "media", key: "item.removed" },
			{ namespace: "media", key: "item.greeting" },
			{
				namespace: "media",
				key: "item.wrapped",
				params: { inner: { key: "a.b", namespace: "x" } },
			},
		]) {
			expect<string>(format(catalogs, "en", message)).toBe("This message is no longer available.");
		}
	});

	it("renders the kernel loading message only while a catalog the message uses is pending", () => {
		expect<string>(
			format(catalogs, "en", { namespace: "loading", key: "item.greeting" }, { isPending }),
		).toBe("…");
		expect<string>(
			format(
				catalogs,
				"en",
				{
					namespace: "media",
					key: "item.wrapped",
					params: { inner: { namespace: "loading", key: "item.greeting" } },
				},
				{ isPending },
			),
		).toBe("…");
		expect<string>(
			format(catalogs, "en", { namespace: "media", key: "item.removed" }, { isPending }),
		).toBe("This message is no longer available.");
		expect<string>(
			format(
				catalogs,
				"en",
				{ namespace: "media", key: "item.greeting", params: { name: "Ana" } },
				{ isPending },
			),
		).toBe("Hello Ana");
	});

	it("renders model-facing text in the source locale", () => {
		const greeting = { namespace: "media", key: "item.greeting", params: { name: "Ana" } };
		expect<string>(formatForModel(catalogs, greeting)).toBe("Hello Ana");
	});

	it("passes user-authored display text through and renders message references", () => {
		expect<string>(formatDisplayText(portuguese, "Olá {name}")).toBe("Olá {name}");
		expect<string>(
			formatDisplayText(portuguese, {
				namespace: "media",
				key: "item.greeting",
				params: { name: "Rui" },
			}),
		).toBe("Olá Rui");
	});

	it("fails loudly when the kernel catalog itself is missing", () => {
		expect(() => format(emptyCatalogRegistry, "en", { key: "a.b", namespace: "kernel" })).toThrow(
			"The kernel catalog is not registered",
		);
	});
});

describe("formatters", () => {
	it("reuses formatters per locale and options", () => {
		const formatters = formattersFor("de");
		expect(formattersFor("de")).toBe(formatters);
		expect(formatters.number({ maximumFractionDigits: 1 })).toBe(
			formatters.number({ maximumFractionDigits: 1 }),
		);
		expect(formatters.number({ maximumFractionDigits: 1 }).format(1234.56)).toBe("1.234,6");
		expect(formatters.list({ type: "conjunction" }).format(["a", "b", "c"])).toBe("a, b und c");
	});
});
