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

The destination must have each required system package, identified by its permanent UUID. An exact
source-hash match is accepted; a newer revision must pass the archived schema and value checks.
Restore does not install, replace, downgrade, or configure system plugins for other users.
Hashes check archive consistency, not the publisher's identity. Private packages include their
manifests and compiled archives; restore validates them without compiling them.

Typed plugin references bind to the destination's local plugin IDs with their system or private
scope preserved. Equal plugin names do not merge data. A retained private package that conflicts
with a system UUID stays private and quarantined, with its data intact. It needs explicit validation
before it can run again. Removing the conflict does not enable it automatically.

Arbitrary entity IDs or ID-like strings in plugin JSON are not made portable or rewritten. Use the
supported typed references for data that must move between instances.

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
Private plugin archives retain their compiled artifacts. Custom renderer source is rebuilt through
the renderer compiler during restore.

After a successful restore, reset the account before you restore any archive again.

## Whole-server backups

Portable account backups do not replace a whole-server backup. Before an upgrade or move, back up
the database and permanent file storage. Include the local persistent volume, or follow your S3
provider's backup procedure.
