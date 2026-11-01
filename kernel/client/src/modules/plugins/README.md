# Plugin client services

Executable workspace menus use ready, non-hidden installations. Direct routes retain exact local
plugin IDs; a hidden or quarantined entry is never resolved through a matching metadata name.
Client code, operations, device storage, and prepared-page freshness use exact local ownership.

`/settings/plugins` is a kernel-owned management screen. It reads `pluginInstallationsRecipe`,
including unavailable private installations, independently of the executable workspace catalog.
Management renders metadata and retained state without preparing or loading plugin client code.
Hidden intent, health, incompatibility reason, and completed initialization are separate fields.

State, configuration, package updates, and removal use exact installation IDs. Package updates
carry the displayed source hash and an uploaded archive token. System package configuration,
updates, and removal remain deployment administrator actions. Removal requires confirmation and
retains the backend's reference checks; there is no forced removal. Successful commands refresh
server state rather than assuming a recovery completed or initialization ran again.
