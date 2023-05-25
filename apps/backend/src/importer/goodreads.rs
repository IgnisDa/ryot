use async_graphql::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    books::BookSpecifics,
    config::ImporterConfig,
    media::{resolver::MediaDetails, MediaSpecifics},
    migrator::{BookSource, MetadataLot},
};

use super::{
    DeployGoodreadsImportInput, ImportItem, ImportItemIdentifier, ImportItemRating,
    ImportItemReview, ImportItemSeen, ImportResult,
};

#[derive(Debug, Serialize, Deserialize)]
struct RssBookDetails {
    #[serde(default)]
    num_pages: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct RssItem {
    title: String,
    book_description: String,
    author_name: String,
    book_large_image_url: String,
    book_id: i32,
    book: RssBookDetails,
    book_published: String,
    user_shelves: String,
    user_read_at: String,
    user_review: String,
    user_rating: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct RssChannel {
    title: String,
    item: Vec<RssItem>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RssDetail {
    channel: RssChannel,
}

pub async fn import(
    input: DeployGoodreadsImportInput,
    config: &ImporterConfig,
) -> Result<ImportResult> {
    let content = surf::get(format!(
        "{}/{}",
        config.goodreads_rss_url, input.profile_url
    ))
    .await
    .unwrap()
    .body_string()
    .await
    .unwrap();
    let books: RssDetail = quick_xml::de::from_str(&content).unwrap();
    let books = books.channel.item.into_iter().collect::<Vec<_>>();
    Ok(ImportResult {
        media: books
            .into_iter()
            .map(|d| {
                let mut reviews = vec![];
                let mut single_review = ImportItemRating {
                    id: None,
                    review: None,
                    rating: None,
                };
                if !d.user_review.is_empty() {
                    single_review.review = Some(ImportItemReview {
                        date: None,
                        spoiler: false,
                        text: d.user_review,
                    });
                };
                if !d.user_rating.is_empty() {
                    let rating = d.user_rating.parse().unwrap();
                    if rating != 0 {
                        single_review.rating = Some(rating)
                    }
                };
                if single_review.review.is_some() || single_review.rating.is_some() {
                    reviews.push(single_review);
                }

                let mut seen_history = vec![];
                if !d.user_read_at.is_empty() {
                    seen_history.push(ImportItemSeen {
                        id: None,
                        ended_on: DateTime::parse_from_rfc2822(&d.user_read_at)
                            .ok()
                            .map(|d| d.with_timezone(&Utc)),
                        show_season_number: None,
                        show_episode_number: None,
                        podcast_episode_number: None,
                    });
                }
                ImportItem {
                    source_id: d.book_id.to_string(),
                    lot: MetadataLot::Book,
                    identifier: ImportItemIdentifier::AlreadyFilled(MediaDetails {
                        identifier: d.book_id.to_string(),
                        title: d.title,
                        description: Some(d.book_description),
                        lot: MetadataLot::Book,
                        creators: vec![d.author_name],
                        genres: vec![],
                        poster_images: vec![d.book_large_image_url],
                        backdrop_images: vec![],
                        publish_year: d.book_published.parse().ok(),
                        publish_date: None,
                        specifics: MediaSpecifics::Book(BookSpecifics {
                            pages: d.book.num_pages.parse().ok(),
                            source: BookSource::Goodreads,
                        }),
                    }),
                    seen_history,
                    reviews,
                }
            })
            .collect(),
        failed_items: vec![],
    })
}

pub mod utils {
    use regex::Regex;

    // Written with the help of ChatGPT.
    pub fn extract_user_id(url: &str) -> Option<String> {
        let re = Regex::new(r"/(\d+)-").unwrap();
        if let Some(captures) = re.captures(url) {
            if let Some(user_id) = captures.get(1) {
                return Some(user_id.as_str().to_string());
            }
        }
        None
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use rstest::rstest;

        #[rstest]
        #[case(
            "https://www.goodreads.com/user/show/1235116436-ignisda",
            Some("143396636")
        )]
        #[case("https://www.goodreads.com/user/show/1234-example", Some("1234"))]
        #[case("https://www.goodreads.com/user/show/invalid-url", None)]
        fn test_extract_user_id(#[case] url: &str, #[case] expected_user_id: Option<&str>) {
            let user_id = extract_user_id(url);
            assert_eq!(user_id, expected_user_id.map(String::from));
        }
    }
}
