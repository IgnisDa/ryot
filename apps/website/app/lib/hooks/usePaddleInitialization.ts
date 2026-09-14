import { useEffect } from "react";

import { initializePaddleForApplication, useConfigData } from "~/lib/general";

export const usePaddleInitialization = (paddleCustomerId?: string) => {
	const { isLoading, data: configData } = useConfigData();

	useEffect(() => {
		if (configData) {
			void initializePaddleForApplication(
				configData.clientToken,
				configData.isSandbox,
				paddleCustomerId,
			);
		}
	}, [configData, paddleCustomerId]);

	return { isLoading, configData };
};
