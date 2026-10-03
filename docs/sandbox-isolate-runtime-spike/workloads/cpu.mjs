import { load } from "@ryot-app/sandbox-sdk/cheerio";
import { XMLParser } from "@ryot-app/sandbox-sdk/fast-xml-parser";
import { Effect, Schema } from "effect";
const Item = Schema.Struct({ id: Schema.String, title: Schema.String, year: Schema.Number, tags: Schema.Array(Schema.String) });
export default () =>
	Effect.runPromise(
		Effect.gen(function* () {
			let html = "<html><body><ul>";
			for (let i = 0; i < 8000; i++) html += `<li class="item" data-id="${i}"><a href="/m/${i}">Movie ${i}</a><span class="y">${1950 + (i % 70)}</span></li>`;
			html += "</ul></body></html>";
			const $ = load(html);
			const rows = $("li.item").map((_, el) => ({ id: $(el).attr("data-id"), title: $(el).find("a").text(), year: Number($(el).find(".y").text()), tags: ["a", "b"] })).get();
			let xml = "<feed>";
			for (let i = 0; i < 8000; i++) xml += `<entry><id>${i}</id><title>Ep ${i}</title><dur>${i * 3}</dur></entry>`;
			xml += "</feed>";
			const parsed = new XMLParser().parse(xml);
			const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(Item))(rows);
			return { rows: decoded.length, entries: parsed.feed.entry.length };
		}),
	);
