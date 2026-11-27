import { describe, expect, it } from "bun:test";

import { Result, Schema } from "effect";

import {
	CATALOG_LIMITS,
	type CatalogDiagnostic,
	CompiledCatalog,
	compiledCatalogIssues,
	formatCatalogDiagnostic,
} from "../catalog";
import { hasCatalogErrors, validateCatalogSources } from "./validate";

const file = (locale: string, messages: unknown) => ({
	locale,
	path: `messages/${locale}.json`,
	content: JSON.stringify(messages),
});

const codes = (diagnostics: ReadonlyArray<CatalogDiagnostic>) =>
	diagnostics
		.map(({ key, code, severity }) => [severity, code, key ?? null])
		.sort((left, right) => (String(left) < String(right) ? -1 : 1));

const english = {
	"item.greeting": "Hello {name}, last seen {at, date, short}",
	"item.status": "{status, select, done {Done} pending {Pending} other {Unknown}}",
	"item.count": {
		description: "Item count",
		message: "{count, plural, one {# item} other {# items}}",
	},
};

describe("catalog validation", () => {
	it("compiles valid catalogs and types arguments from English", () => {
		const result = validateCatalogSources([
			file("en", english),
			file("de", { "item.greeting": "Hallo {name}, zuletzt {at, date, medium}" }),
		]);
		expect(codes(result.diagnostics)).toEqual([
			["warning", "missing-translation", "item.count"],
			["warning", "missing-translation", "item.status"],
		]);
		expect(hasCatalogErrors(result.diagnostics)).toBe(false);
		expect(result.locales).toEqual(["en", "de"]);
		expect(result.descriptions.get("item.count")).toBe("Item count");
		expect(Object.fromEntries(result.arguments)).toEqual({
			"item.count": { count: { kind: "number" } },
			"item.greeting": { at: { kind: "date" }, name: { kind: "text" } },
			"item.status": { status: { kind: "select", codes: ["done", "pending"] } },
		});
	});

	it("rejects syntax, markup, styles, keys and entries", () => {
		const result = validateCatalogSources([
			file("en", {
				"Item.Bad": "Bad key",
				"item.broken": "{name",
				"item.positional": "{0} things",
				"item.markup": "Hello <b>{name}</b>",
				"item.style": "{amount, number, currency}",
				"item.conflict": "{value} and {value, number}",
				"item.entry": { message: "Text", note: "unexpected" },
			}),
		]);
		expect(codes(result.diagnostics)).toEqual([
			["error", "argument-conflict", "item.conflict"],
			["error", "invalid-entry", "item.entry"],
			["error", "invalid-key", "Item.Bad"],
			["error", "invalid-syntax", "item.broken"],
			["error", "invalid-syntax", "item.positional"],
			["error", "markup", "item.markup"],
			["error", "unsupported-style", "item.style"],
		]);
	});

	it("compiles number skeletons and rejects currency and unit skeletons", () => {
		const result = validateCatalogSources([
			file("en", {
				"item.share": "{n, number, ::percent .0}",
				"item.price": "{n, number, ::currency/EUR}",
				"item.compact": "{n, number, ::compact-short}",
				"item.distance": "{n, number, ::unit/kilometer}",
				"item.length": "{n, number, ::measure-unit/length-meter}",
			}),
		]);
		expect(codes(result.diagnostics)).toEqual([
			["error", "unsupported-style", "item.distance"],
			["error", "unsupported-style", "item.length"],
			["error", "unsupported-style", "item.price"],
		]);
		expect(result.catalogs.get("en")?.["item.compact"]).toEqual([
			{ type: 2, value: "n", style: { notation: "compact", compactDisplay: "short" } },
		]);
		expect(
			Result.isFailure(
				Schema.decodeUnknownResult(CompiledCatalog)({
					"item.price": [{ type: 2, value: "n", style: { currency: "EUR", style: "currency" } }],
				}),
			),
		).toBe(true);
	});

	it("compiles date skeletons to locale-independent options and rejects the rest", () => {
		const result = validateCatalogSources([
			file("en", {
				"item.cycle": "{at, time, ::Jm}",
				"item.period": "{at, time, ::hma}",
				"item.flexible": "{at, time, ::Cm}",
				"item.clock": "{at, time, ::HHmmss}",
				"item.fraction": "{at, time, ::jmsS}",
				"item.year": "{at, date, ::yyyyMMMd}",
				"item.weekday": "{at, date, ::EEEEEE}",
				"item.expires": "{at, date, ::yMMMdjm}",
				"item.repeated": "{at, date, ::yMMMdhj}",
			}),
		]);
		expect(codes(result.diagnostics)).toEqual([
			["error", "unsupported-style", "item.cycle"],
			["error", "unsupported-style", "item.flexible"],
			["error", "unsupported-style", "item.fraction"],
			["error", "unsupported-style", "item.period"],
			["error", "unsupported-style", "item.repeated"],
			["error", "unsupported-style", "item.weekday"],
			["error", "unsupported-style", "item.year"],
		]);
		const catalog = result.catalogs.get("en");
		expect(catalog?.["item.expires"]).toEqual([
			{
				type: 3,
				value: "at",
				style: {
					day: "numeric",
					month: "short",
					hour: "numeric",
					year: "numeric",
					minute: "numeric",
				},
			},
		]);
		expect(catalog?.["item.clock"]).toEqual([
			{
				type: 4,
				value: "at",
				style: { hour: "2-digit", hourCycle: "h23", minute: "2-digit", second: "2-digit" },
			},
		]);
	});

	it("compiles calendar-date styles to UTC dates that translations must keep", () => {
		const result = validateCatalogSources([
			file("en", {
				"item.clock": "{day, time, calendar-short}",
				"item.airs": "Airs {day, date, calendar-medium}",
			}),
			file("de", { "item.airs": "Läuft am {day, date, medium}" }),
		]);
		expect(codes(result.diagnostics)).toEqual([
			["error", "argument-mismatch", "item.airs"],
			["error", "unsupported-style", "item.clock"],
		]);
		expect(result.arguments.get("item.airs")).toEqual({ day: { kind: "calendar-date" } });
		expect(result.catalogs.get("en")?.["item.airs"]).toEqual([
			{ type: 0, value: "Airs " },
			{
				type: 3,
				value: "day",
				style: { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
			},
		]);
		expect(
			codes(
				compiledCatalogIssues({
					"item.zoned": [{ type: 4, value: "at", style: { hour: "numeric", timeZone: "UTC" } }],
				}),
			),
		).toEqual([["error", "unsupported-style", "item.zoned"]]);
	});

	it("compiles zoned date-time styles that translations must keep", () => {
		const result = validateCatalogSources([
			file("en", {
				"item.mixed": "{at, date, zoned-short} {at, time, short}",
				"item.due": "Due {at, date, zoned-medium} at {at, time, zoned-short}",
			}),
			file("de", { "item.due": "Fällig am {at, date, medium} um {at, time, short}" }),
		]);
		expect(codes(result.diagnostics)).toEqual([
			["error", "argument-conflict", "item.mixed"],
			["error", "argument-mismatch", "item.due"],
		]);
		expect(result.arguments.get("item.due")).toEqual({ at: { kind: "zoned-date-time" } });
		expect(result.catalogs.get("en")?.["item.due"]).toEqual([
			{ type: 0, value: "Due " },
			{
				type: 3,
				value: "at",
				style: { day: "numeric", month: "short", year: "numeric", timeZone: "argument" },
			},
			{ type: 0, value: " at " },
			{ type: 4, value: "at", style: { hour: "numeric", minute: "numeric", timeZone: "argument" } },
		]);
	});

	it("rejects translations that drift from English", () => {
		const result = validateCatalogSources([
			file("en", english),
			file("fr", {
				"item.extra": "Pas en anglais",
				"item.greeting": "Bonjour {name}, vu {at}",
				"item.status": "{status, select, done {Fait} other {Inconnu}}",
				"item.count": "{total, plural, one {# article} other {# articles}}",
			}),
		]);
		expect(codes(result.diagnostics)).toEqual([
			["error", "argument-mismatch", "item.count"],
			["error", "argument-mismatch", "item.count"],
			["error", "argument-mismatch", "item.greeting"],
			["error", "argument-mismatch", "item.status"],
			["error", "key-not-in-source", "item.extra"],
		]);
	});

	it("requires the source locale and rejects pseudo or non-canonical locale files", () => {
		const result = validateCatalogSources([
			file("de", { "item.greeting": "Hallo" }),
			file("en-XA", {}),
			file("pt_BR", {}),
		]);
		expect(codes(result.diagnostics)).toEqual([
			["error", "invalid-locale", null],
			["error", "invalid-locale", null],
			["error", "missing-source-locale", null],
		]);
	});

	it("applies size, length, nesting, branch and selector limits", () => {
		const nested =
			"{a, select, x {{b, select, x {{c, select, x {{d, select, x {deep} other {d}}} other {c}}} other {b}}} other {a}}";
		const branches = `{n, select, ${Array.from({ length: CATALOG_LIMITS.maxBranches }, (_, index) => `c${index} {x}`).join(" ")} other {y}}`;
		const result = validateCatalogSources([
			file("en", {
				"item.nested": nested,
				"item.branches": branches,
				"item.only-other": "{kind, select, other {Any}}",
				"item.long": "x".repeat(CATALOG_LIMITS.maxMessageLength + 1),
			}),
		]);
		expect(codes(result.diagnostics)).toEqual([
			["error", "invalid-selector", "item.only-other"],
			["error", "message-too-long", "item.long"],
			["error", "too-deeply-nested", "item.nested"],
			["error", "too-many-branches", "item.branches"],
		]);
		expect(
			codes(
				validateCatalogSources([
					{ locale: "en", path: "en.json", content: " ".repeat(CATALOG_LIMITS.maxFileBytes + 1) },
				]).diagnostics,
			)[0],
		).toEqual(["error", "file-too-large", null]);
	});

	it("prints diagnostics with file, key and code", () => {
		expect(
			formatCatalogDiagnostic({
				severity: "error",
				key: "item.broken",
				code: "invalid-syntax",
				file: "messages/en.json",
				detail: "EXPECT_ARGUMENT_CLOSING_BRACE",
			}),
		).toBe("messages/en.json: item.broken: error invalid-syntax: EXPECT_ARGUMENT_CLOSING_BRACE");
	});
});
