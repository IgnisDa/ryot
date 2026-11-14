import { PublicationId } from "@ryot-app/contract/schema/brands";
import { useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";

import { previewPublicationMutation } from "./service";
import { previewHash } from "./visit-session";

export function usePublicationPreview() {
	const navigate = useNavigate();
	const preview = useRyotMutation(previewPublicationMutation);
	return {
		isPending: preview.isPending,
		open: (publicationId: string) =>
			void Effect.runPromise(
				preview
					.mutateEffect({ publicationId: PublicationId.make(publicationId) })
					.pipe(
						Effect.match({
							onFailure: () => undefined,
							onSuccess: (session) =>
								void navigate({
									params: { publicationId },
									hash: previewHash(session),
									to: "/share/$publicationId",
								}),
						}),
					),
			),
	};
}
