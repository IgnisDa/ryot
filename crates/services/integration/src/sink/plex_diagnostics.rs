use serde_json::{Map, Value, error::Category};

const MAX_PAYLOAD_BYTES: usize = 64 * 1024;
const MAX_GUIDS: usize = 8;
const METADATA_FIELDS: &[&str] = &[
    "type",
    "duration",
    "viewOffset",
    "grandparentTitle",
    "parentIndex",
    "index",
    "Guid",
];

pub(super) fn describe_parse_error(error: &serde_json::Error) -> String {
    let description = match error.classify() {
        Category::Eof => "incomplete JSON".to_owned(),
        Category::Syntax => "invalid JSON syntax".to_owned(),
        Category::Io => "could not read JSON".to_owned(),
        Category::Data => {
            let message = error.to_string();
            let field = message.split('`').nth(1).filter(|field| {
                METADATA_FIELDS.contains(field)
                    || [
                        "event", "user", "owner", "Account", "Metadata", "title", "id",
                    ]
                    .contains(field)
            });
            match (message.starts_with("missing field `"), field) {
                (true, Some(field)) => format!("missing required field `{field}`"),
                _ => "unexpected field type or value".to_owned(),
            }
        }
    };
    format!(
        "{description} at line {}, column {}",
        error.line(),
        error.column()
    )
}

fn summarize_field(value: &Value) -> Value {
    match value {
        Value::String(_) => Value::from("[string omitted]"),
        Value::Object(_) => Value::from("[object omitted]"),
        Value::Array(_) => Value::from("[array omitted]"),
        _ => value.clone(),
    }
}

fn summarize_guid(value: &Value) -> Value {
    let Some(id) = value.get("id") else {
        return if value.is_object() {
            Value::Object(Map::new())
        } else {
            summarize_field(value)
        };
    };
    let is_external_id = id.as_str().is_some_and(|id| {
        ["tmdb://", "tvdb://", "imdb://tt"].iter().any(|prefix| {
            id.strip_prefix(prefix).is_some_and(|number| {
                !number.is_empty()
                    && number.len() <= 20
                    && number.bytes().all(|byte| byte.is_ascii_digit())
            })
        })
    });
    serde_json::json!({ "id": if is_external_id { id.clone() } else { summarize_field(id) } })
}

fn summarize_metadata(value: &Value) -> Value {
    let Some(metadata) = value.as_object() else {
        return summarize_field(value);
    };
    Value::Object(
        METADATA_FIELDS
            .iter()
            .filter_map(|&key| {
                let value = metadata.get(key)?;
                let summary = match (key, value) {
                    ("Guid", Value::Array(guids)) => {
                        Value::Array(guids.iter().take(MAX_GUIDS).map(summarize_guid).collect())
                    }
                    ("type", Value::String(kind))
                        if matches!(kind.as_str(), "episode" | "movie") =>
                    {
                        value.clone()
                    }
                    _ => summarize_field(value),
                };
                Some((key.to_owned(), summary))
            })
            .collect(),
    )
}

pub(crate) fn payload_details(payload: &str) -> String {
    if payload.len() > MAX_PAYLOAD_BYTES {
        return format!(
            "Plex webhook payload is too large to summarize ({} bytes)",
            payload.len()
        );
    }
    let payload = match serde_json::from_str::<Value>(payload) {
        Ok(Value::Object(payload)) => payload,
        Ok(_) => return "Plex webhook payload is not a JSON object".to_owned(),
        Err(error) => return format!("Plex webhook payload: {}", describe_parse_error(&error)),
    };
    let summary = ["event", "user", "owner", "Metadata"]
        .into_iter()
        .filter_map(|key| {
            let value = payload.get(key)?;
            let summary = match (key, value) {
                ("Metadata", _) => summarize_metadata(value),
                ("event", Value::String(event))
                    if matches!(
                        event.as_str(),
                        "media.play"
                            | "media.pause"
                            | "media.resume"
                            | "media.stop"
                            | "media.scrobble"
                    ) =>
                {
                    value.clone()
                }
                _ => summarize_field(value),
            };
            Some((key.to_owned(), summary))
        })
        .collect::<Map<_, _>>();
    format!("Plex webhook fields\n{:#}", Value::Object(summary))
}
