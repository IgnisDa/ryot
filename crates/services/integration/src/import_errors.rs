use importer_models::ImportFailedItem;

fn bounded(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        value.to_owned()
    } else {
        format!("{}…", &value[..value.floor_char_boundary(max_bytes - 3)])
    }
}

pub(super) fn summarize(failures: &[ImportFailedItem]) -> String {
    let sample = failures
        .iter()
        .take(3)
        .map(|failure| {
            format!(
                "{}: {}",
                bounded(&failure.identifier, 128),
                bounded(failure.error.as_deref().unwrap_or("unknown error"), 512)
            )
        })
        .collect::<Vec<_>>()
        .join("; ");
    format!(
        "Progress import failed for {} item(s): {}",
        failures.len(),
        sample
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_total_and_first_three_errors() {
        let failures = (0..100)
            .map(|id| ImportFailedItem {
                identifier: format!("item-{id}"),
                error: Some(format!("404 failure-{id}")),
                ..Default::default()
            })
            .collect::<Vec<_>>();
        let summary = summarize(&failures);
        assert!(summary.starts_with("Progress import failed for 100 item(s):"));
        assert!(summary.contains("item-0: 404 failure-0"));
        assert!(summary.contains("item-2: 404 failure-2"));
        assert!(!summary.contains("item-3:"));
    }

    #[test]
    fn bounds_large_unicode_identifiers_and_errors() {
        let failures = vec![
            ImportFailedItem {
                identifier: "📚".repeat(1000),
                error: Some(format!("404 {}", "壊".repeat(10000))),
                ..Default::default()
            };
            100
        ];
        let summary = summarize(&failures);
        assert!(summary.len() < 2048);
        assert!(summary.contains("404"));
        assert_eq!(summary.matches('…').count(), 6);
    }

    #[test]
    fn handles_missing_error_details() {
        let summary = summarize(&[ImportFailedItem {
            identifier: "chapter".into(),
            ..Default::default()
        }]);
        assert!(summary.ends_with("chapter: unknown error"));
    }
}
