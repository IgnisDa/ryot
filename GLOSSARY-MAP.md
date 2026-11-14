# Glossary Map

## Contexts

- [Kernel](./GLOSSARY.md): the domain-independent platform, plugin lifecycle, tracked data, organization, data exchange, automation, and account boundaries.
- [Media](./plugins/media/GLOSSARY.md): media consumption, discovery, credits, and monitoring.
- [Fitness](./plugins/fitness/GLOSSARY.md): exercises, workout execution and plans, measurements, and personal performance.

## Relationships

- **Kernel → Plugins**: the kernel supplies entity, event, relationship, installation, collection, saved-view, and execution concepts. Plugins supply domain definitions and behavior.
- **Media → Kernel**: Media defines media entities and personal consumption events using kernel concepts; library membership and monitoring remain Media concepts.
- **Fitness → Kernel**: Fitness defines exercises, workouts, templates, and measurements using kernel concepts; workout sets are exercise events grouped by a workout session entity.
- **Media ↔ Fitness**: both use the kernel vocabulary, but neither defines the other's domain. Shared local names such as `review` do not imply shared definitions.

Compiler, sandbox, SDK, transport, and storage details belong in their owning READMEs, not domain glossaries. The fixture plugin supplies test scenarios, not a separate product domain.
