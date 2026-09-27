import { layer } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { DownloadTicketInvalid, DownloadTickets } from "./download-tickets";
import { HmacSigner } from "./hmac-signer";

const ticketsLayer = DownloadTickets.layer.pipe(
	Layer.provide(HmacSigner.layer),
	Layer.provide(
		makeAppConfigLayer({
			server: { adminAccessToken: Redacted.make("download-ticket-test-secret") },
		}),
	),
);

layer(ticketsLayer)((test) => {
	test.effect("binds tickets to a subject, purpose, and resource", () =>
		Effect.gen(function* () {
			const tickets = yield* DownloadTickets;
			const ticket = yield* tickets.issue({
				resource: "run-1",
				subject: "user-1",
				purpose: "backup-run",
			});

			const claims = yield* tickets.verify(ticket, { resource: "run-1", purpose: "backup-run" });
			expect(claims.subject).toBe("user-1");
			expect(claims.expiresAt).toBeGreaterThan(0);

			const wrongPurpose = yield* Effect.flip(
				tickets.verify(ticket, { resource: "run-1", purpose: "server-logs-all" }),
			);
			const wrongResource = yield* Effect.flip(
				tickets.verify(ticket, { resource: "run-2", purpose: "backup-run" }),
			);
			const tampered = yield* Effect.flip(
				tickets.verify(ticket.replace("user-1", "user-2"), {
					resource: "run-1",
					purpose: "backup-run",
				}),
			);

			expect(wrongPurpose).toBeInstanceOf(DownloadTicketInvalid);
			expect(wrongResource).toBeInstanceOf(DownloadTicketInvalid);
			expect(tampered).toBeInstanceOf(DownloadTicketInvalid);
		}),
	);

	test.effect("expires tickets after the allowed window", () =>
		Effect.gen(function* () {
			const tickets = yield* DownloadTickets;
			const ticket = yield* tickets.issue({
				subject: null,
				resource: "all",
				purpose: "server-logs-all",
			});

			yield* TestClock.adjust("6 minutes");
			const expired = yield* Effect.flip(
				tickets.verify(ticket, { resource: "all", purpose: "server-logs-all" }),
			);
			expect(expired).toBeInstanceOf(DownloadTicketInvalid);
		}),
	);
});
