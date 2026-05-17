import { AuthenticatedLayout } from "@/modules/auth/authenticated-layout";
import { WorkspaceShell } from "@/modules/navigation/workspace-shell";

export default function ShellLayout() {
	return (
		<AuthenticatedLayout>
			<WorkspaceShell />
		</AuthenticatedLayout>
	);
}
