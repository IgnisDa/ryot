// Responsible for importing from https://github.com/bonukai/MediaTracker.

pub mod utils {
    use chrono::NaiveDate;
    use regex::Regex;

    #[derive(Debug)]
    pub struct ReviewInformation {
        pub date: NaiveDate,
        pub spoiler: bool,
        pub text: String,
    }

    // DEV: The below code was written using ChatGPT
    pub fn extract_review_info(input: &str) -> Vec<ReviewInformation> {
        let review_regex = Regex::new(r"(?m)^(\d{2}/\d{2}/\d{4}):(\s*\[SPOILER\])?\n\n((?:[^\n]+(?:\n|$)){1,}.*(?:\n|$)?)(?:(?:\n\n---\n\n)|(?:\n---\n)|(?:\n\n---\n))?").unwrap();
        let mut result = vec![];
        for capture in review_regex.captures_iter(input) {
            let date = NaiveDate::parse_from_str(&capture[1], "%d/%m/%Y").unwrap();
            let spoiler = capture
                .get(2)
                .map_or(false, |m| m.as_str().contains("[SPOILER]"));
            let text = capture[3].trim().to_string();
            result.push(ReviewInformation {
                date,
                spoiler,
                text,
            });
        }
        result
    }
}
