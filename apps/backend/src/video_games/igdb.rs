use anyhow::{anyhow, Result};
use chrono::{DateTime, Datelike, Utc};
use serde::{Deserialize, Serialize};
use serde_with::serde_as;
use serde_with::{formats::Flexible, TimestampSeconds};
use surf::Client;

use crate::{
    config::VideoGameConfig,
    media::{
        resolver::{MediaSearchItem, MediaSearchResults},
        LIMIT,
    },
    utils::{convert_option_path_to_vec, igdb},
};

use super::VideoGameSpecifics;

static FIELDS: &str = "
fields
    id,
    name,
    summary,
    cover.*, 
    first_release_date,
    artworks.*,
    rating,
    genres.*;
where version_parent = null; 
";

#[derive(Serialize, Deserialize, Debug)]
struct IgdbGenre {
    name: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct IgdbImage {
    url: String,
}

#[serde_as]
#[derive(Serialize, Deserialize, Debug)]
struct IgdbSearchResponse {
    id: i32,
    name: String,
    summary: Option<String>,
    cover: Option<IgdbImage>,
    #[serde_as(as = "Option<TimestampSeconds<i64, Flexible>>")]
    first_release_date: Option<DateTime<Utc>>,
    rating: Option<f32>,
    artworks: Option<Vec<IgdbImage>>,
    genres: Option<Vec<IgdbGenre>>,
}

#[derive(Debug, Clone)]
pub struct IgdbService {
    client: Client,
}

impl IgdbService {
    pub async fn new(video_game_config: &VideoGameConfig) -> Self {
        let client = igdb::get_client_config(
            &video_game_config.twitch.access_token_url,
            &video_game_config.twitch.client_id,
            &video_game_config.twitch.client_secret,
            &video_game_config.igdb.base_url,
        )
        .await;
        Self { client }
    }
}

impl IgdbService {
    pub async fn details(&self, identifier: &str) -> Result<MediaSearchItem> {
        let req_body = format!(
            r#"
{field}
where id = {id};
            "#,
            field = FIELDS,
            id = identifier
        );
        let mut rsp = self
            .client
            .post("games")
            .body_string(req_body)
            .await
            .map_err(|e| anyhow!(e))?;

        let mut details: Vec<IgdbSearchResponse> = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let detail = details.pop().unwrap();
        Ok(igdb_response_to_search_response(detail))
    }

    pub async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let req_body = format!(
            r#"
{field}
search "{query}"; 
limit {LIMIT};
offset: {offset};
            "#,
            field = FIELDS,
            offset = page.unwrap_or_default() * LIMIT
        );
        let mut rsp = self
            .client
            .post("games")
            .body_string(req_body)
            .await
            .map_err(|e| anyhow!(e))?;

        let search: Vec<IgdbSearchResponse> = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let total = search.len() as i32;

        let resp = search
            .into_iter()
            .map(igdb_response_to_search_response)
            .collect::<Vec<_>>();
        Ok(MediaSearchResults { total, items: resp })
    }
}

fn igdb_response_to_search_response(item: IgdbSearchResponse) -> MediaSearchItem {
    let backdrop_images = item
        .artworks
        .unwrap_or_default()
        .into_iter()
        .map(|a| a.url)
        .collect();
    let poster_images = convert_option_path_to_vec(item.cover.map(|p| p.url));
    MediaSearchItem {
        identifier: item.id.to_string(),
        title: item.name,
        description: item.summary,
        author_names: vec![],
        publish_date: item.first_release_date.map(|d| d.date_naive()),
        publish_year: item.first_release_date.map(|d| d.year()),
        genres: item
            .genres
            .unwrap_or_default()
            .into_iter()
            .map(|g| g.name)
            .collect(),
        video_game_specifics: Some(VideoGameSpecifics {
            rating: item.rating,
        }),
        movie_specifics: None,
        book_specifics: None,
        show_specifics: None,
        poster_images,
        backdrop_images,
    }
}
