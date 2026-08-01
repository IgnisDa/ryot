import { SectionFrame } from "@/modules/ui/section-frame";
import { AccountScreen } from "@/modules/user-settings/account-screen";

export default function AccountSettings() {
	return (
		<SectionFrame title="Account">
			<AccountScreen />
		</SectionFrame>
	);
}
