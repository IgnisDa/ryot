# Remove Memberships And Harden Write Access

**Parent Plan:** [Collections Write Foundation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Complete the initial collections write feature by adding removal behavior and hardening the write
surface around access control and intentionally allowed graph shapes. This slice should delete
existing `member_of` relationships, enforce ownership and visibility rules for collection writes,
and verify that collection-to-collection membership and cycle writes are accepted in this phase.

The end-to-end result should be that users can remove memberships they own, cannot mutate another
user's collections, and can still create collection-to-collection relationships and cycles because
recursive traversal is out of scope for the write model. See the parent PRD sections **Addability
and cycles**, **Ownership and access control**, and **Delete semantics**.

## Acceptance criteria

- [x] The backend exposes an authenticated remove-from-collection write contract keyed by
      `collectionId`.
- [x] Removing an entity from a collection deletes the matching `member_of` relationship.
- [x] Users cannot add to or remove from collections they do not own.
- [x] Membership writes require the acting user to have visibility to the member entity being
      linked.
- [x] The write surface allows a collection entity to be added to another collection entity.
- [x] The write surface allows cycle creation in this slice and does not introduce recursive
      traversal logic.
- [x] Backend tests cover ownership checks and removal behavior.
- [x] `tests/src` includes end-to-end coverage for removal, cross-user access rejection,
      collection-to-collection membership, and cycle acceptance.
- [x] `bun run typecheck`, `bun test`, and `bun run lint` pass in `apps/app-backend`.

## Blocked by

- [Task 03](./03-add-or-update-collection-memberships.md)

## User stories addressed

- User story 10
- User story 11
- User story 12
- User story 13
- User story 29
- User story 30
- User story 31
- User story 32
- User story 33
