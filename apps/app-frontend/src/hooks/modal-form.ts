import { useDisclosure } from "@mantine/hooks";
import { useCallback, useRef, useState } from "react";

import { getErrorMessage } from "~/lib/errors";

export function useModalForm<TPayload>(mutateFn: (payload: TPayload) => Promise<unknown>) {
	const mutateFnRef = useRef(mutateFn);
	mutateFnRef.current = mutateFn;

	const [opened, { open, close }] = useDisclosure(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const openModal = useCallback(() => {
		setErrorMessage(null);
		open();
	}, [open]);

	const closeModal = useCallback(() => {
		setErrorMessage(null);
		close();
	}, [close]);

	const submit = useCallback(
		async (payload: TPayload) => {
			setErrorMessage(null);
			try {
				await mutateFnRef.current(payload);
				closeModal();
			} catch (err) {
				setErrorMessage(getErrorMessage(err));
			}
		},
		[closeModal],
	);

	return { opened, errorMessage, open: openModal, close: closeModal, submit };
}
