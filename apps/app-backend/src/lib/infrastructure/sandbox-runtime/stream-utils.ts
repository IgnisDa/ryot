import { Effect, Stream } from "effect";

export const readSandboxByteLimitedStream = <E, R, O>(
	stream: Stream.Stream<Uint8Array, E, R>,
	limit: number,
	oversized: O,
) =>
	stream.pipe(
		Stream.runFoldEffect(
			() => ({ bytes: 0, chunks: [] as Uint8Array[] }),
			(state, chunk) => {
				const bytes = state.bytes + chunk.byteLength;
				if (bytes > limit) {
					return Effect.fail(oversized);
				}

				state.chunks.push(chunk);
				return Effect.succeed({ bytes, chunks: state.chunks });
			},
		),
		Effect.map(({ bytes, chunks }) => {
			const body = new Uint8Array(bytes);
			let offset = 0;
			for (const chunk of chunks) {
				body.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return body;
		}),
	);
