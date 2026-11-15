# Languages

Environment-neutral ISO 639 lookup shared by providers, manifests, clients, and legacy conversion.
Codes normalize to ISO 639-1 where available and ISO 639-3 otherwise. Bibliographic and terminology
aliases resolve to the same identity. `canonicalLanguagePattern` validates that stored identity;
`languageCodeForIso6393` adapts it to APIs requiring three-letter codes.

English names come from the ISO registry. Reverse lookup rejects ambiguous or unknown names. Provider-specific
codes and legacy labels belong to their owning plugin or migration.
