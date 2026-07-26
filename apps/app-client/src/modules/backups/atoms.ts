import { Atom } from "effect/unstable/reactivity";

import { appClient } from "@/api/client";
import { type ApiScope, canonicalApiScope, scopedReactivityKey } from "@/api/request-key";

const backupRunKeys = (scope: ApiScope) => scopedReactivityKey("backup-runs", scope);

const backupRunsFamily = Atom.family((scope: ApiScope) =>
	appClient(scope).query("backups", "listRuns", { reactivityKeys: backupRunKeys(scope) }),
);

const deleteBackupRunFamily = Atom.family((scope: ApiScope) =>
	appClient(scope).mutation("backups", "deleteRun"),
);

const createBackupExportFamily = Atom.family((scope: ApiScope) =>
	appClient(scope).mutation("backups", "createExport"),
);

const createBackupRestoreFamily = Atom.family((scope: ApiScope) =>
	appClient(scope).mutation("backups", "createRestore"),
);

export const backupRunReactivityKeys = backupRunKeys;

export const backupRunsAtom = (scope: ApiScope) => backupRunsFamily(canonicalApiScope(scope));

export const deleteBackupRunAtom = (scope: ApiScope) =>
	deleteBackupRunFamily(canonicalApiScope(scope));

export const createBackupExportAtom = (scope: ApiScope) =>
	createBackupExportFamily(canonicalApiScope(scope));

export const createBackupRestoreAtom = (scope: ApiScope) =>
	createBackupRestoreFamily(canonicalApiScope(scope));
