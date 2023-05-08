// Responsible for importing from https://github.com/bonukai/MediaTracker.

pub mod utils {
    use chrono::NaiveDate;
    use regex::Regex;

    #[derive(Debug)]
    pub struct ReviewInformation {
        date: NaiveDate,
        spoiler: bool,
        text: String,
    }

    pub fn extract_review_information(input: &str) -> Option<ReviewInformation> {
        let regex_str =
            r"(?m)^(?P<date>\d{2}/\d{2}/\d{4}):(?P<spoiler>\s*\[SPOILER\])?\n\n(?P<text>[\s\S]*)$";
        let regex = Regex::new(regex_str).unwrap();
        if let Some(captures) = regex.captures(input) {
            let date_str = captures.name("date").unwrap().as_str();
            let date = NaiveDate::parse_from_str(date_str, "%d/%m/%Y").ok()?;
            let spoiler = captures
                .name("spoiler")
                .map_or(false, |m| m.as_str().trim() == "[SPOILER]");
            let text = captures.name("text").unwrap().as_str().to_owned();
            Some(ReviewInformation {
                date,
                spoiler,
                text,
            })
        } else {
            None
        }
    }
        }
        result
    }
}
