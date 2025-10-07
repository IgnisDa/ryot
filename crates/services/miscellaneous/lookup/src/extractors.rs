use std::{collections::HashMap, sync::OnceLock};

use media_models::SeenShowExtraInformation;

use crate::patterns::{PatternSet, apply_patterns_with_replacement, extract_captures};

static WORD_TO_NUMBER_MAP: OnceLock<HashMap<&'static str, i32>> = OnceLock::new();

fn word_to_number(word: &str) -> Option<i32> {
    let map = WORD_TO_NUMBER_MAP.get_or_init(|| {
        HashMap::from([
            ("one", 1),
            ("two", 2),
            ("three", 3),
            ("four", 4),
            ("five", 5),
            ("six", 6),
            ("seven", 7),
            ("eight", 8),
            ("nine", 9),
            ("ten", 10),
            ("eleven", 11),
            ("twelve", 12),
            ("thirteen", 13),
            ("fourteen", 14),
            ("fifteen", 15),
            ("sixteen", 16),
            ("seventeen", 17),
            ("eighteen", 18),
            ("nineteen", 19),
            ("twenty", 20),
        ])
    });
    map.get(word.to_lowercase().as_str()).copied()
}

fn roman_to_number(roman: &str) -> Option<i32> {
    let roman = roman.to_uppercase();
    let mut result = 0;
    let mut prev_value = 0;

    for ch in roman.chars().rev() {
        let value = match ch {
            'I' => 1,
            'V' => 5,
            'X' => 10,
            'L' => 50,
            'C' => 100,
            'D' => 500,
            'M' => 1000,
            _ => return None,
        };

        if value < prev_value {
            result -= value;
        } else {
            result += value;
        }
        prev_value = value;
    }

    Some(result)
}

fn parse_number_or_word_or_roman(s: &str) -> Option<i32> {
    s.parse::<i32>()
        .ok()
        .or_else(|| word_to_number(s))
        .or_else(|| roman_to_number(s))
}

fn find_first_capture_group(text: &str, pattern_set: PatternSet) -> Option<String> {
    extract_captures(text, pattern_set, |captures| {
        captures.get(1).map(|cap| cap.as_str().trim().to_string())
    })
}

fn find_two_capture_groups(text: &str, pattern_set: PatternSet) -> Option<(i32, i32)> {
    extract_captures(text, pattern_set, |captures| {
        let first = parse_number_or_word_or_roman(captures.get(1)?.as_str())?;
        let second = captures
            .get(2)
            .and_then(|cap| parse_number_or_word_or_roman(cap.as_str()));

        match second {
            Some(ep) => Some((first, ep)),
            None => Some((1, first)),
        }
    })
}

pub fn clean_title(title: &str) -> String {
    apply_patterns_with_replacement(title, PatternSet::Cleaning, "")
}

pub fn extract_base_title(title: &str) -> String {
    find_first_capture_group(title, PatternSet::BaseExtraction)
        .unwrap_or_else(|| clean_title(title))
}

pub fn extract_year_from_title(title: &str) -> Option<i32> {
    find_first_capture_group(title, PatternSet::YearExtraction)
        .and_then(|year_str| year_str.parse().ok())
}

pub fn extract_season_episode(title: &str) -> Option<SeenShowExtraInformation> {
    find_two_capture_groups(title, PatternSet::SeasonEpisode)
        .map(|(season, episode)| SeenShowExtraInformation { season, episode })
}
