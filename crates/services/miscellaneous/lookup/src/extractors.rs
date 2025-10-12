use std::{collections::HashMap, sync::OnceLock};

use media_models::SeenShowExtraInformation;
use regex::Regex;

use crate::patterns::{PatternSet, apply_patterns_with_replacement, extract_captures};

static WORD_TO_NUMBER_MAP: OnceLock<HashMap<&'static str, i32>> = OnceLock::new();
static EPISODE_PAREN_RE: OnceLock<Regex> = OnceLock::new();
static EPISODE_PLAIN_RE: OnceLock<Regex> = OnceLock::new();
static SXXEYY_RE: OnceLock<Regex> = OnceLock::new();
static SEASON_EPISODE_RE: OnceLock<Regex> = OnceLock::new();

#[derive(Debug)]
struct ParsedTitle {
    base_title: String,
    season: Option<i32>,
    episode: Option<i32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EpisodeSource {
    Parentheses,
    EpisodeLabel,
    ChapterLabel,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GeneralSource {
    SxxExx,
    SeasonEpisode,
}

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
            ("thirty", 30),
            ("forty", 40),
            ("fifty", 50),
            ("sixty", 60),
            ("seventy", 70),
            ("eighty", 80),
            ("ninety", 90),
        ])
    });

    let normalized = word.trim().to_lowercase().replace('-', " ");
    let tokens: Vec<&str> = normalized
        .split_whitespace()
        .filter(|&t| t != "and")
        .collect();

    if tokens.is_empty() {
        return None;
    }

    if tokens.len() == 1 {
        return map.get(tokens[0]).copied();
    }

    let mut total = 0;
    for token in tokens {
        if let Some(&value) = map.get(token) {
            total += value;
        } else {
            return None;
        }
    }

    Some(total)
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

fn alpha_to_number(token: &str) -> Option<i32> {
    if token.len() == 1 {
        let ch = token.chars().next()?.to_ascii_uppercase();
        if ch.is_ascii_alphabetic() {
            return Some((ch as i32) - ('A' as i32) + 1);
        }
    }
    None
}

fn interpret_numeric(token: &str) -> Option<i32> {
    token
        .parse::<i32>()
        .ok()
        .or_else(|| word_to_number(token))
        .or_else(|| roman_to_number(token))
        .or_else(|| alpha_to_number(token))
}

fn parse_number_token(token: &str) -> Option<i32> {
    let trimmed = token
        .trim_matches(|c: char| !c.is_ascii_alphanumeric())
        .trim();
    if trimmed.is_empty() {
        return None;
    }

    interpret_numeric(trimmed).or_else(|| {
        let prefix: String = trimmed
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect();
        if prefix.is_empty() || prefix.eq_ignore_ascii_case(trimmed) {
            None
        } else {
            interpret_numeric(&prefix)
        }
    })
}

fn collapse_spaces(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
        .trim()
        .to_string()
}

fn split_segments(title: &str) -> Vec<String> {
    title
        .split(':')
        .map(|segment| collapse_spaces(segment.trim_matches(|c| c == '"' || c == '\'')))
        .filter(|segment| !segment.is_empty())
        .collect()
}

fn extract_episode(segment: &str) -> Option<(i32, EpisodeSource)> {
    let lower = segment.to_lowercase();
    let paren_re =
        EPISODE_PAREN_RE.get_or_init(|| Regex::new(r"(?i)\(Episode\s+([A-Za-z0-9]+)\)").unwrap());
    if let Some(caps) = paren_re.captures(&lower)
        && let Some(matched) = caps.get(1)
        && let Some(number) = parse_number_token(matched.as_str())
    {
        return Some((number, EpisodeSource::Parentheses));
    }

    let plain_re =
        EPISODE_PLAIN_RE.get_or_init(|| Regex::new(r"(?i)\bEpisode\s+([A-Za-z0-9]+)\b").unwrap());
    if let Some(caps) = plain_re.captures(&lower)
        && let Some(matched) = caps.get(1)
        && let Some(number) = parse_number_token(matched.as_str())
    {
        return Some((number, EpisodeSource::EpisodeLabel));
    }

    if let Some(result) = parse_labelled_episode(segment) {
        return Some(result);
    }

    None
}

fn find_after_keyword<'a>(segment: &'a str, keyword: &str) -> Option<&'a str> {
    let lower = segment.to_lowercase();
    let keyword_lower = keyword.to_lowercase();
    let position = lower.find(&keyword_lower)?;
    let remainder = &segment[position + keyword.len()..];
    Some(remainder.trim_start_matches(|c: char| c == ':' || c == '-' || c.is_whitespace()))
}

fn parse_labelled_season(segment: &str) -> Option<i32> {
    let lower = segment.to_lowercase();
    if lower.contains("limited series") {
        return Some(1);
    }

    for label in &["season", "series", "volume", "book", "part"] {
        if let Some(after) = find_after_keyword(segment, label)
            && let Some(token) = after.split_whitespace().next()
            && let Some(value) = parse_number_token(token)
        {
            return Some(value);
        }
    }

    None
}

fn parse_labelled_episode(segment: &str) -> Option<(i32, EpisodeSource)> {
    if let Some(after) = find_after_keyword(segment, "chapter")
        && let Some(token) = after.split_whitespace().next()
        && let Some(value) = parse_number_token(token)
    {
        return Some((value, EpisodeSource::ChapterLabel));
    }
    None
}

fn parse_repeated_base_season(segment: &str, first_segment: &str) -> Option<i32> {
    if first_segment.is_empty() {
        return None;
    }

    let segment_trimmed = segment.trim();
    let first_trimmed = first_segment.trim();

    let segment_lower = segment_trimmed.to_lowercase();
    let first_lower = first_trimmed.to_lowercase();

    if let Some(dot_pos) = segment_trimmed.find(". ") {
        let before_dot = &segment_trimmed[..dot_pos];
        let after_dot = segment_trimmed[dot_pos + 2..].trim();

        if let Some(season_num) = parse_number_token(before_dot) {
            if after_dot.to_lowercase() == first_lower {
                return Some(season_num);
            }
        }
    }

    if segment_lower.starts_with(&first_lower) {
        let remainder = segment_trimmed[first_trimmed.len()..].trim();
        if !remainder.is_empty()
            && remainder.split_whitespace().count() == 1
            && let Some(value) = parse_number_token(remainder)
        {
            return Some(value);
        }
    }

    if let Some(first_word) = first_trimmed.split_whitespace().next() {
        let word_lower = first_word.to_lowercase();
        if segment_lower.starts_with(&word_lower) {
            let remainder = segment_trimmed[first_word.len()..].trim();
            if !remainder.is_empty()
                && remainder.split_whitespace().count() == 1
                && let Some(value) = parse_number_token(remainder)
            {
                return Some(value);
            }
        }
    }

    None
}

fn parse_numeric_segment(segment: &str) -> Option<i32> {
    if segment
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return parse_number_token(segment);
    }
    None
}

fn extract_general_season_episode(title: &str) -> Option<(i32, i32, GeneralSource)> {
    let lower = title.to_lowercase();
    let sxxeyy_re =
        SXXEYY_RE.get_or_init(|| Regex::new(r"(?i)\bS(\d{1,3})\s*E(\d{1,3})\b").unwrap());
    if let Some(caps) = sxxeyy_re.captures(&lower)
        && let (Some(season_cap), Some(episode_cap)) = (caps.get(1), caps.get(2))
    {
        let season = parse_number_token(season_cap.as_str())?;
        let episode = parse_number_token(episode_cap.as_str())?;
        return Some((season, episode, GeneralSource::SxxExx));
    }

    let season_episode_re = SEASON_EPISODE_RE.get_or_init(|| {
        Regex::new(r"(?i)season\s+([A-Za-z0-9]+)[^A-Za-z0-9]+episode\s+([A-Za-z0-9]+)").unwrap()
    });
    if let Some(caps) = season_episode_re.captures(&lower)
        && let (Some(season_cap), Some(episode_cap)) = (caps.get(1), caps.get(2))
    {
        let season = parse_number_token(season_cap.as_str())?;
        let episode = parse_number_token(episode_cap.as_str())?;
        return Some((season, episode, GeneralSource::SeasonEpisode));
    }

    None
}

fn parse_title(title: &str) -> ParsedTitle {
    let trimmed = title.trim();
    let segments = split_segments(trimmed);
    if segments.is_empty() {
        return ParsedTitle {
            base_title: clean_title(title),
            season: None,
            episode: None,
        };
    }

    let general_pair = extract_general_season_episode(trimmed);
    let mut base_segments = Vec::new();
    let mut season = None;
    let mut episode = None;
    let mut episode_source = None;
    let mut encountered_structure = false;
    let first_segment = segments[0].clone();

    for segment in segments.iter() {
        if let Some((number, source)) = extract_episode(segment) {
            episode = Some(number);
            episode_source = Some(source);
            encountered_structure = true;
            continue;
        }

        if let Some(value) = parse_labelled_season(segment) {
            season = Some(value);
            encountered_structure = true;
            continue;
        }

        if season.is_none() {
            if let Some(value) = parse_repeated_base_season(segment, &first_segment) {
                season = Some(value);
                encountered_structure = true;
                continue;
            }

            if let Some(value) = parse_numeric_segment(segment) {
                season = Some(value);
                encountered_structure = true;
                continue;
            }
        }

        if encountered_structure {
            continue;
        }

        base_segments.push(segment.clone());
    }

    if base_segments.is_empty() {
        base_segments.push(first_segment.clone());
    }

    let has_colon = title.contains(':');
    let mut base_title = if has_colon {
        base_segments.join(": ")
    } else {
        String::new()
    };

    if !has_colon {
        if let Some(idx) = trimmed.find('(') {
            let prefix = trimmed[..idx].trim();
            if prefix.is_empty() {
                base_title = clean_title(title);
            } else {
                base_title = clean_title(prefix);
            }
        } else {
            base_title = clean_title(title);
        }
    } else if base_title.trim().is_empty() {
        base_title = clean_title(title);
    } else {
        base_title = clean_title(&base_title);
    }

    if let Some((general_season, general_episode, general_source)) = general_pair {
        let override_episode = matches!(episode_source, Some(EpisodeSource::EpisodeLabel))
            && general_source == GeneralSource::SxxExx;

        if episode.is_none() || override_episode {
            episode = Some(general_episode);
        }

        if season.is_none() || override_episode {
            season = Some(general_season);
        }
    }

    if season.is_none()
        && let Some(source) = episode_source
    {
        match source {
            EpisodeSource::Parentheses | EpisodeSource::ChapterLabel => {
                season = Some(1);
            }
            EpisodeSource::EpisodeLabel => {}
        }
    }

    ParsedTitle {
        base_title,
        season,
        episode,
    }
}

pub fn clean_title(title: &str) -> String {
    let mut cleaned = apply_patterns_with_replacement(title, PatternSet::Cleaning, "");

    loop {
        let before = cleaned.clone();
        cleaned = cleaned
            .replace(": :", ":")
            .replace("  ", " ")
            .trim_end_matches(':')
            .trim_end_matches('(')
            .trim_end_matches(')')
            .trim_end_matches(' ')
            .to_string();

        if cleaned == before {
            break;
        }
    }

    cleaned
}

pub fn extract_base_title(title: &str) -> String {
    parse_title(title).base_title
}

pub fn extract_year_from_title(title: &str) -> Option<i32> {
    extract_captures(title, PatternSet::YearExtraction, |captures| {
        captures
            .get(1)
            .and_then(|cap| cap.as_str().trim().parse::<i32>().ok())
    })
}

pub fn extract_season_episode(title: &str) -> Option<SeenShowExtraInformation> {
    let parsed = parse_title(title);
    match (parsed.season, parsed.episode) {
        (Some(season), Some(episode)) => Some(SeenShowExtraInformation { season, episode }),
        _ => None,
    }
}
