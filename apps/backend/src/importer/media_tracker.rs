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

    #[cfg(test)]
    mod tests {
        use super::*;
        use rstest::rstest;

        #[rstest]
        #[case(
            "01/05/2023:\n\nThe movie was fantastic! Highly recommend.",
            NaiveDate::from_ymd_opt(2023, 5, 1).unwrap(),
            false,
            "The movie was fantastic! Highly recommend."
        )]
        #[case(
            "01/05/2023: [SPOILER]\n\nThe ending was unexpected.",
            NaiveDate::from_ymd_opt(2023, 5, 1).unwrap(),
            true,
            "The ending was unexpected."
        )]
        #[case(
            "14/04/2023:\n\nShort and sweet romance.\n\nDefinitely worth the 7-8hrs I spent reading it.",
            NaiveDate::from_ymd_opt(2023, 4, 14).unwrap(),
            false,
            "Short and sweet romance.\n\nDefinitely worth the 7-8hrs I spent reading it."
        )]
        #[case(
            "12/08/2019:\n\nA text to start with.\nAnother text to end with.",
            NaiveDate::from_ymd_opt(2019, 8, 12).unwrap(),
            false,
            "A text to start with.\nAnother text to end with."
        )]
        fn test_extract_review_information(
            #[case] input: &str,
            #[case] expected_date: NaiveDate,
            #[case] expected_is_spoiler: bool,
            #[case] expected_text: &str,
        ) {
            let info = extract_review_information(input);
            assert!(info.is_some());

            let info = info.unwrap();
            assert_eq!(info.date, expected_date);
            assert_eq!(info.spoiler, expected_is_spoiler);
            assert_eq!(info.text, expected_text);
        }
    }
}
