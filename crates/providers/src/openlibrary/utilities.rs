use chrono::NaiveDate;

/// Extract the key part from OpenLibrary URLs
pub fn get_key(key: &str) -> String {
    key.rsplit('/').next().unwrap_or_default().to_owned()
}

/// Parse various date formats used by OpenLibrary
pub fn parse_date(date_str: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(date_str, "%e %B %Y").ok()
}

/// Parse date with multiple formats
pub fn parse_date_flexible(input: &str) -> Option<NaiveDate> {
    let formats = ["%b %d, %Y", "%Y"];
    for format in formats.iter() {
        if let Ok(date) = NaiveDate::parse_from_str(input, format) {
            return Some(date);
        }
    }
    None
}
