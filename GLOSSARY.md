# Ryot Kernel

Ryot's kernel is the domain-independent platform for personal tracking. Plugins define tracking domains using its shared concepts.

## Language

### Platform

**Kernel**:
The domain-independent platform that provides shared capabilities for plugins.

**Plugin**:
An extension that defines a tracking domain and its behavior. Media and Fitness are plugins, not built-in kernel domains.

**System plugin**:
A plugin available at the instance level rather than owned privately by one user. Its provider-supplied entities are global, while each user's installation and activity remain personal.
_Avoid_: Kernel feature

**Private plugin**:
A plugin owned by and available only to one user, including its provider-supplied entities.
_Avoid_: Custom entity

**Package identity**:
The permanent publisher-qualified name of a plugin package, independent of its display name, revision, or instance-local plugin identity.

**Local plugin identity**:
The stable identity of an exact system or privately owned plugin within one Ryot instance, preserved across its revisions. Two users' private plugins can have the same package identity without being the same local plugin.
_Avoid_: Installation identity, display name

**Plugin revision**:
An immutable edition of a plugin's declarations and executable content. A version label alone does not identify a revision.

**Plugin installation**:
One user's adoption of an exact plugin, with its own lifecycle, settings, and workspace choices. A system plugin can have separate installations for different users.
_Avoid_: Package, revision

**Plugin configuration**:
Execution settings for a plugin, including any declared secrets. System-plugin configuration comes from the instance environment; private-plugin configuration belongs to its user's installation.
_Avoid_: User preferences

**Plugin preferences**:
Non-secret personal choices for one user's exact plugin installation, with defaults defined by that plugin.
_Avoid_: Plugin configuration, account preferences

**Initialization**:
Completion of an installation's initial user setup, independent of its current readiness or visibility.
_Avoid_: Readiness

**Readiness**:
An installation's current setup health, distinct from whether initialization previously completed.
_Avoid_: Initialization, visibility

**Quarantine**:
An incompatible state that prevents a conflicting private installation from being used while retaining its data and configuration.
_Avoid_: Uninstall, deletion

### Tracked Data

**Custom entity**:
An entity created for one user without provider provenance, whether entered directly or imported as custom data. It is always private and remains distinct from a provider-supplied entity describing the same subject.
_Avoid_: Private entity as a synonym, custom media item as a platform-wide term

**Provider-supplied entity**:
An entity supplied by a plugin's provider. Entities supplied by system-plugin providers are global and shared across users; private-plugin providers supply entities private to their user.

**Entity**:
A subject represented in Ryot, such as a movie, exercise, workout, or collection. Its entity schema defines its kind and properties.

**Global entity**:
An entity shared across users rather than belonging to one user. Shared identity does not make users' activity or personal relationships shared.

**User-owned entity**:
An entity private to one user, including custom entities and entities supplied by private-plugin providers.
_Avoid_: Custom entity as a synonym

**Provider provenance**:
The provider and external identity identifying an entity within its schema and ownership scope. A matching name alone does not establish a shared identity.

**Definition owner**:
The kernel or exact plugin that declares a schema or other named definition. Definitions with the same local name but different owners are distinct.

**Entity schema**:
An owner-qualified definition of an entity kind, its properties, and the event kinds applicable to it.

**Event**:
A user's recorded fact about an entity at an occurrence time, optionally associated with a session entity. Events are distinct from automation triggers and notification signals.
_Avoid_: Trigger, signal

**Event schema**:
An owner-qualified definition of a kind of recorded fact and its properties for a particular entity kind.

**Session entity**:
An entity that groups events into a shared activity context, such as a workout grouping sets recorded against exercises.
_Avoid_: Authentication session

**Event projection**:
Derived values calculated from recorded events, separate from the facts supplied in those events.

**Relationship**:
A directed, typed link between two entities, with its own properties and global or user ownership. A user's relationship may annotate a global entity without making that entity private.

**Relationship schema**:
An owner-qualified definition of a relationship kind, its permitted endpoints, properties, and user-write ownership rules.

**Entity user data**:
One user's recorded events and personal relationships associated with an entity, separate from the entity's shared properties and provider provenance.

**Entity user-data merge**:
Transfer of a user's activity and personal relationships from one entity to another compatible entity of the same owner-qualified schema. It is distinct from declaring the entities to be the same provider identity.
_Avoid_: Catalog deduplication

**Entity interest**:
A client's temporary declaration that entities are currently relevant to its display and may need enrichment or refreshed derived values. It is not persistent library membership or a subscription to domain changes.
_Avoid_: Monitoring, library membership

**RyotQL**:
Ryot's query language for selecting visible data and definitions under the caller's authority, without granting ownership or write access.

### Organization

**Library**:
A plugin-defined personal grouping of entities selected by a user. A library is distinct from the global entities available through providers and from kernel collections.
_Avoid_: Catalog, collection

**Library membership**:
A user's inclusion of an entity in a plugin-defined library, whether added directly or through plugin behavior. Removing membership stops listing it there without deleting its recorded activity or collection memberships.
_Avoid_: Tracking status, ownership

**Collection**:
A named, user-owned kernel entity that groups entities through explicit membership, optionally with collection-specific membership fields.
_Avoid_: Library, saved view

**Collection membership**:
A user's explicit inclusion of an entity in a collection, with any values for that collection's membership fields.

**Saved view**:
A named presentation of selected data and its settings, supplied by the kernel, a plugin, or a user. It is not itself a collection of explicitly chosen members.
_Avoid_: Collection

**Built-in saved view**:
A saved view defined by the kernel or a plugin, with personal visibility and order choices kept separate from its definition.

**Custom saved view**:
A saved view owned and defined by a user, rather than a personal override of a built-in view.

**Workspace**:
The user's navigable plugin area associated with an exact installation, including its selected home and associated saved views.
_Avoid_: Plugin package, library

**Calendar source**:
A plugin-defined selection of dated occurrences for the kernel Calendar, with either date-only or exact-time meaning.

### Data Exchange

**Entity provider**:
A plugin-defined source of entity identities and descriptive data, with optional search, identity resolution, and translation.
_Avoid_: Integration provider, import source

**Provider population**:
Enrichment of a provider-supplied entity and its related entities and relationships from provider data.
_Avoid_: Activity import

**Import source**:
A declared way to interpret incoming user data and turn it into entities, events, and relationships. Sources can be supplied by plugins or by the kernel.
_Avoid_: Entity provider

**Import run**:
One admitted execution of an import source or incoming integration delivery, with its own progress, issues, and outcome. Cancellation preserves data already committed by the run.

**Integration provider**:
A declared connection type for exchanging user data with an external service, distinct from a provider of entity metadata.
_Avoid_: Entity provider

**Integration**:
A user's configured connection to an integration provider, with its own settings and enabled state.
_Avoid_: Import run, OAuth connection

**Sink integration**:
An incoming integration that receives deliveries sent by an external service.
_Avoid_: Push integration

**Yank integration**:
An incoming integration that retrieves user data from an external service.
_Avoid_: Entity provider

**Push integration**:
An outgoing integration that sends selected Ryot data or changes to an external service.
_Avoid_: Sink integration

**OAuth connection**:
A user's authorization for a particular external account, bound to an integration settings field when used. It is separate from the user's Ryot login.

**Account backup**:
A portable record of an account's data, settings, private plugins, and required system-plugin identities for restoration into a clean account.
_Avoid_: Data import

### Automation And Delivery

**Plugin operation**:
A named plugin action exposed to authorized user or integration callers.

**Lifecycle hook**:
A plugin-declared response to a matching mutation request, committed change, signal, or provider-import completion.

**Before policy**:
A lifecycle hook that accepts, rejects, or transforms a proposed change before it is committed, without making its own mutations.
_Avoid_: After hook

**After hook**:
A lifecycle hook that reacts to a committed change, emitted signal, or completed provider import. Its failure does not undo an already committed source change.
_Avoid_: Before policy

**Automation trigger**:
Captured evidence and causation for matching lifecycle hooks, distinct from a user's recorded event.
_Avoid_: Event

**Automation run**:
One selected hook's execution against captured trigger evidence using its accepted plugin revision and configuration. A run can have multiple execution attempts.

**Signal**:
A typed announcement with a defined audience, available to matching hooks and notification subscriptions. It is distinct from recorded activity and from the message ultimately delivered.
_Avoid_: Event, notification

**Notification subscription**:
A user's selection of an exact kernel- or plugin-owned signal kind for notifications.

**Notification channel**:
A user's configured destination and delivery method for notification messages.

### Accounts And Assets

**Account**:
A user's identity and personal data boundary within one Ryot instance, spanning that user's plugin installations and activity.
_Avoid_: Workspace, plugin installation

**Account preferences**:
Personal platform choices shared across an account, separate from installation-specific plugin preferences.

**Demo access**:
Restricted authority attached to a demo login or credential, not an inherent property of the underlying account.

**Managed asset**:
An uploaded file managed by Ryot and referenced from application data, distinct from an externally hosted media URL.
