# Entity reminders

Open a Media title or episode, or a Fitness exercise, workout or template, and select **Reminders**.
Select **New reminder**, enter a message, then choose a future date, time and timezone.

The saved time is fixed. Travel or a device timezone change does not move it. A time skipped by a
daylight-saving change is invalid. If the clock repeats a time, choose which occurrence you mean.

Reminders use server notification channels, not a device alarm. The server checks every five minutes
by default. Delivery can be late, including after server downtime. Check the delivery status and
notification subscription before scheduling; creating a reminder does not enable either one.

## Manage reminders

Use **Settings → Reminders** to see all your reminders:

- **Upcoming**: edit or cancel a reminder before processing starts.
- **Needs scheduling**: imported or restored reminders that cannot send yet. Choose **Schedule reminder**
  and enter a new future time. The original date and message remain available as context.
- **History**: read the outcome, inspect channel results, schedule another occurrence or remove history.

Each reminder is independent. Creating or cancelling one does not change library membership.
Removing an entity's library data clears its reminders. Merging data transfers reminders without
combining matching messages or times.

## Delivery results

**Accepted** means the provider acknowledged the request, not that you read it. **Partial** means some
channels accepted it. **Failed**, **Delivery unknown** and **Not sent** explain other outcomes; see
[Notifications](./notifications.md). Unknown requests are never resent automatically. Enabling a
subscription or channel later does not replay a Not sent occurrence.

Cancellation prevents unsent work. It cannot recall a request that has already started.
Detailed channel diagnostics expire after 30 days; the reminder's compact outcome remains.

Backup restore leaves unfinished reminders inactive under **Needs scheduling**. A reminder restored
while processing may already have sent; check that warning before scheduling another occurrence.
V1 date-only reminders also need a new time and timezone. Migration never fires them.
