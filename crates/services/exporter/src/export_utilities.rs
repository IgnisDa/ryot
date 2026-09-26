use media_models::{ImportOrExportItemRating, ImportOrExportItemReview, ReviewItem};
use sea_orm::{EnumIter, strum::Display};

#[derive(Eq, PartialEq, Copy, Display, Clone, Debug, EnumIter)]
#[strum(serialize_all = "snake_case")]
pub enum ExportItem {
    People,
    Workouts,
    Metadata,
    Exercises,
    Collections,
    Measurements,
    MetadataGroups,
    WorkoutTemplates,
}

pub fn get_review_export_item(rev: ReviewItem) -> ImportOrExportItemRating {
    let (show_season_number, show_episode_number) = match rev.show_extra_information {
        Some(d) => (d.season, d.episode),
        None => (None, None),
    };
    let podcast_episode_number = rev.podcast_extra_information.and_then(|d| d.episode);
    let anime_episode_number = rev.anime_extra_information.and_then(|d| d.episode);
    let manga_chapter_number = rev.manga_extra_information.and_then(|d| d.chapter);
    ImportOrExportItemRating {
        rating: rev.rating,
        show_season_number,
        show_episode_number,
        anime_episode_number,
        manga_chapter_number,
        podcast_episode_number,
        comments: match rev.comments.is_empty() {
            true => None,
            false => Some(rev.comments),
        },
        review: Some(ImportOrExportItemReview {
            text: rev.text_original,
            date: Some(rev.posted_on),
            spoiler: Some(rev.is_spoiler),
            visibility: Some(rev.visibility),
        }),
    }
}
