import { type Exit, Option, Tracer } from "effect";

export const makeRecordingTracer = (spans: Tracer.Span[]) =>
	Tracer.make({
		span: ({ name, kind, links, parent, sampled, startTime, annotations }) => {
			let status: Tracer.SpanStatus = { startTime, _tag: "Started" };
			const attributes = new Map<string, unknown>();
			const sequence = spans.length + 1;
			const span: Tracer.Span = {
				name,
				kind,
				links,
				parent,
				sampled,
				attributes,
				annotations,
				_tag: "Span",
				event: () => undefined,
				addLinks: () => undefined,
				spanId: `span-${sequence}`,
				get status() {
					return status;
				},
				attribute: (key, value) => attributes.set(key, value),
				end: (endTime, exit: Exit.Exit<unknown, unknown>) => {
					status = { exit, endTime, startTime, _tag: "Ended" };
				},
				traceId: parent.pipe(
					Option.map((value) => value.traceId),
					Option.getOrElse(() => `trace-${sequence}`),
				),
			};
			spans.push(span);
			return span;
		},
	});

export const recordedStatements = (spans: ReadonlyArray<Tracer.Span>) =>
	spans.flatMap((span) => {
		const text = span.attributes.get("db.query.text");
		return typeof text === "string" ? [text] : [];
	});

export const maxBindParameter = (statement: string) =>
	Math.max(...[...statement.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
