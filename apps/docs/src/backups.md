# Back Up and Restore

## What a backup includes

- Profile preferences.
- Media, fitness, measurement, and collection data.
- History, reviews, workouts, and other activity.
- Custom renderer source, saved views, workspace home selections, and notification preferences.
- Integrations and their non-secret settings.
- Uploaded images, videos, and other files managed by Ryot.

The archive also identifies catalog items without contacting providers during restore.

## What a backup does not include

- Passwords, sign-in sessions, connected accounts, or API keys.
- Integration credentials or notification destination secrets.
- Sink webhook tokens. Restored sink integrations receive new webhook URLs that must be configured
  in the sending service.
- Server settings and background task history.
- Files linked from other websites.

Plugin fields declared as secrets are omitted.

## Creating a backup

Open **Settings > Backups** and select **Create a backup**. The server creates it in the background.
You can close Ryot and return to the same page to check progress.

Only one backup or restore can be pending or running for an account. Wait for it to finish or fail
before you start another.

Download the finished `.zip` archive. On mobile, Ryot opens the system share sheet. Deleting a
backup removes only its record and archive, not account data.

## Keeping backups safe

Download links expire after 24 hours. Store the archive securely because it can contain private
history and uploaded files.

## Restoring a backup

A restore requires a new or reset account with no personal data or custom settings. Records that
plugins create during account setup are allowed and matched by schema ownership.

The destination must have the exact system-plugin versions and source hashes recorded in the
archive. These hashes check compatibility; they are not cryptographic signatures. The archive
includes account-owned private plugin manifests and source packages. Ryot validates and compiles
them before restore.

Secret plugin and integration fields are omitted, but the archive records which ones were set. A
plugin missing a required secret remains inactive with `needs-configuration` health. An integration
missing one is restored disabled. Plugin source can contain embedded credentials that Ryot cannot
reliably redact.

Open **Settings > Backups**, select **Restore from a backup**, and upload the `.zip` archive. Ryot
validates it before writing data. A damaged or incomplete archive does not change the account.

Do not upload a backup through **Settings > Import data**.

## Archive compatibility

The current format is `ryot-backup` version 1. Ryot validates the manifest, paths, record counts,
and section and asset checksums. It rejects other ZIP files and unsupported formats or versions.
Compiled client-page artifacts are derived from renderer and plugin source and are rebuilt after
restore; they are not stored in the backup.

After a successful restore, reset the account before you restore any archive again.

## Whole-server backups

Portable account backups do not replace a whole-server backup. Before an upgrade or move, back up
the database and permanent file storage. Include the local persistent volume, or follow your S3
provider's backup procedure.
