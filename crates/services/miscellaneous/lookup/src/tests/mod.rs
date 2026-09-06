use super::*;
use extractors::{clean_title, extract_base_title, extract_season_episode};
use matching::find_best_match;
use rstest::rstest;

mod basic_extraction;
mod best_match;
mod episode_extraction;
mod integration;
mod netflix_formats;
mod show_information;

const ANDOR_CLEAN: &str = "Andor";
const MATRIX_CLEAN: &str = "The Matrix";
const ANDOR_EPISODE: &str = "Andor S01E01";
const ANDOR_WITH_YEAR: &str = "Andor (2022)";
const BREAKING_BAD_CLEAN: &str = "Breaking Bad";
const MATRIX_WITH_YEAR: &str = "The Matrix (1999)";
const BREAKING_BAD_EPISODE: &str = "Breaking Bad S01E01";
const ANDOR_COMPLEX: &str = "Andor (2022) S01E01 720p WEBRip";
const BREAKING_BAD_SEASON_EPISODE: &str = "Breaking Bad Season 1 Episode 2";
const HOUSE_EPISODE: &str = "House, M.D.: Season 7: Two Stories (Episode 13)";
const BREAKING_BAD_SEASON_EPISODE_COMPLEX: &str = "Breaking Bad Season 1 Episode 2 1080p BluRay";
