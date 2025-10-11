use std::sync::OnceLock;

use regex::Regex;

static COMPILED_SPACE_REGEX: OnceLock<Regex> = OnceLock::new();
static COMPILED_CLEANING_PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
static COMPILED_YEAR_EXTRACTION_PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();

static YEAR_EXTRACTION_PATTERNS: &[&str] = &[r"\(([12]\d{3})\)", r"\[([12]\d{3})\]"];
static CLEANING_PATTERNS: &[&str] = &[
    r"\([12]\d{3}\)",
    r"\[[12]\d{3}\]",
    r"S\d+E\d+",
    r"(?i)Season\s+\d+",
    r"(?i)Episode\s+\d+",
    r"(?i)\b(720p|1080p|4K|HDTV|HD|SD|CAM|TS|TC|DVDRip|BRRip|BluRay|WEBRip|WEB-DL)\b",
    r"(?i)\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v)$",
    r"(?i)(PROPER|REPACK|EXTENDED|UNRATED|DIRECTOR.?S.?CUT)",
    r"\[.*?\]",
    r"\{.*?\}",
];

pub enum PatternSet {
    Cleaning,
    YearExtraction,
}

impl PatternSet {
    fn get_patterns_and_cache(&self) -> (&[&str], &'static OnceLock<Vec<Regex>>) {
        match self {
            PatternSet::Cleaning => (CLEANING_PATTERNS, &COMPILED_CLEANING_PATTERNS),
            PatternSet::YearExtraction => {
                (YEAR_EXTRACTION_PATTERNS, &COMPILED_YEAR_EXTRACTION_PATTERNS)
            }
        }
    }
}

fn get_compiled_patterns<'a>(patterns: &[&str], cache: &'a OnceLock<Vec<Regex>>) -> &'a Vec<Regex> {
    cache.get_or_init(|| {
        patterns
            .iter()
            .filter_map(|pattern| Regex::new(pattern).ok())
            .collect()
    })
}

pub fn get_space_regex() -> &'static Regex {
    COMPILED_SPACE_REGEX.get_or_init(|| Regex::new(r"\s+").unwrap())
}

pub fn apply_patterns_with_replacement(
    text: &str,
    pattern_set: PatternSet,
    replacement: &str,
) -> String {
    let mut result = text.to_string();
    let (patterns, cache) = pattern_set.get_patterns_and_cache();
    let compiled_patterns = get_compiled_patterns(patterns, cache);

    for re in compiled_patterns {
        result = re.replace_all(&result, replacement).to_string();
    }

    let space_re = get_space_regex();
    space_re.replace_all(result.trim(), " ").to_string()
}

pub fn extract_captures<T>(
    text: &str,
    pattern_set: PatternSet,
    extractor: impl Fn(&regex::Captures) -> Option<T>,
) -> Option<T> {
    let (patterns, cache) = pattern_set.get_patterns_and_cache();
    let compiled_patterns = get_compiled_patterns(patterns, cache);

    compiled_patterns.iter().find_map(|re| {
        let captures = re.captures(text)?;
        extractor(&captures)
    })
}
