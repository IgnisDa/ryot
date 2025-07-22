use chrono::NaiveDate;

pub fn get_key(key: &str) -> String {
    key.rsplit('/').next().unwrap_or_default().to_owned()
}

pub fn parse_date(date_str: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(date_str, "%e %B %Y").ok()
}

pub fn parse_date_flexible(input: &str) -> Option<NaiveDate> {
    let formats = ["%b %d, %Y", "%Y"];
    for format in formats.iter() {
        if let Ok(date) = NaiveDate::parse_from_str(input, format) {
            return Some(date);
        }
    }
    None
}
