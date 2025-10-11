use super::*;

#[rstest]
#[case(ANDOR_WITH_YEAR, ANDOR_CLEAN)]
#[case(MATRIX_WITH_YEAR, MATRIX_CLEAN)]
#[case("Movie [2020]", "Movie")]
#[case("Show Name (2023) Extra", "Show Name Extra")]
#[case(BREAKING_BAD_EPISODE, BREAKING_BAD_CLEAN)]
#[case("Game of Thrones S8E6", "Game of Thrones")]
#[case("The Office Season 2", "The Office")]
#[case("Friends Episode 10", "Friends")]
#[case("Movie 720p", "Movie")]
#[case("Show 1080p BluRay", "Show")]
#[case("Film HDTV", "Film")]
#[case("Series WEBRip", "Series")]
#[case("Movie DVDRip", "Movie")]
#[case("Movie.mp4", "Movie")]
#[case("Show.mkv", "Show")]
#[case("Film.avi", "Film")]
#[case("Series.mov", "Series")]
#[case("Movie PROPER", "Movie")]
#[case("Show REPACK", "Show")]
#[case("Film EXTENDED", "Film")]
#[case("Series DIRECTOR'S CUT", "Series")]
#[case("Movie [Release Group]", "Movie")]
#[case("Show {Extra Info}", "Show")]
#[case("Film [720p] {Group}", "Film")]
#[case("Andor (2022) S01E01 720p WEBRip [Group]", "Andor")]
#[case("Breaking Bad Season 1 Episode 2 1080p BluRay", "Breaking Bad")]
#[case("The Matrix (1999) DIRECTOR'S CUT 4K.mkv", "The Matrix")]
fn test_clean_title(#[case] input: &str, #[case] expected: &str) {
    assert_eq!(clean_title(input), expected);
}

#[rstest]
#[case(ANDOR_WITH_YEAR, ANDOR_CLEAN)]
#[case(MATRIX_WITH_YEAR, MATRIX_CLEAN)]
#[case("Movie Name (2020) Extra", "Movie Name")]
#[case(BREAKING_BAD_EPISODE, BREAKING_BAD_CLEAN)]
#[case("Game of Thrones S8E6", "Game of Thrones")]
#[case("The Office Season 2", "The Office")]
#[case("Friends season 1", "Friends")]
#[case("Movie 720p", "Movie")]
#[case("Show [Group]", "Show")]
#[case("Film.mkv", "Film")]
fn test_extract_base_title(#[case] input: &str, #[case] expected: &str) {
    assert_eq!(extract_base_title(input), expected);
}
