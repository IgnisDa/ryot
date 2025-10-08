use super::*;

#[test]
fn test_extract_show_information_for_tv_shows() {
    let result = extract_show_information(ANDOR_EPISODE, &MediaLot::Show);
    assert!(result.is_some());
    let info = result.unwrap();
    assert_eq!(info.season, 1);
    assert_eq!(info.episode, 1);
}

#[test]
fn test_extract_show_information_for_movies() {
    let result = extract_show_information(MATRIX_WITH_YEAR, &MediaLot::Movie);
    assert!(result.is_none());
}

#[test]
fn test_extract_show_information_tv_show_no_episode() {
    let result = extract_show_information("Just Show Name", &MediaLot::Show);
    assert!(result.is_none());
}
