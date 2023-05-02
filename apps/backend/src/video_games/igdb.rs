use anyhow::{anyhow, Result};
use chrono::{DateTime, Datelike, Utc};
use serde::{Deserialize, Serialize};
use serde_with::serde_as;
use serde_with::{formats::Flexible, TimestampSeconds};
use surf::Client;

use crate::media::LIMIT;
use crate::{
    config::VideoGameConfig,
    media::resolver::{MediaSearchItem, MediaSearchResults},
    utils::{convert_date_to_year, convert_option_path_to_vec, convert_string_to_date, igdb},
};

use super::VideoGameSpecifics;

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
    artworks: Option<Vec<IgdbImage>>,
    genres: Option<Vec<IgdbGenre>>,
}

#[derive(Debug, Clone)]
pub struct IgdbService {
    client: Client,
    image_url: String,
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
        Self {
            client,
            image_url: "".to_owned(),
        }
    }
}

impl IgdbService {
    pub async fn details(&self, identifier: &str) -> Result<MediaSearchItem> {
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct IgdbCreator {
            name: String,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct IgdbMovie {
            id: i32,
            title: String,
            overview: String,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            production_companies: Vec<IgdbCreator>,
            release_date: String,
            runtime: i32,
        }
        let mut rsp = self
            .client
            .get(format!("movie/{}", identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let data: IgdbMovie = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let poster_images =
            convert_option_path_to_vec(data.poster_path.map(|p| self.get_cover_image_url(&p)));
        let backdrop_images =
            convert_option_path_to_vec(data.backdrop_path.map(|p| self.get_cover_image_url(&p)));
        let detail = MediaSearchItem {
            identifier: data.id.to_string(),
            title: data.title,
            author_names: data
                .production_companies
                .into_iter()
                .map(|p| p.name)
                .collect(),
            poster_images,
            backdrop_images,
            publish_year: convert_date_to_year(&data.release_date),
            publish_date: convert_string_to_date(&data.release_date),
            description: Some(data.overview),
            movie_specifics: None,
            video_game_specifics: Some(VideoGameSpecifics { genres: vec![] }),
            book_specifics: None,
            show_specifics: None,
        };
        Ok(detail)
    }

    pub async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let req_body = format!(
            r#"
fields 
    id,
    name,
    summary,
    cover.*, 
    first_release_date,
    artworks.*,
    genres.*;
search "{query}"; 
where version_parent = null; 
limit {LIMIT};
offset: {offset};
            "#,
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
            .map(|d| {
                let backdrop_images = d
                    .artworks
                    .unwrap_or_default()
                    .into_iter()
                    .map(|a| a.url)
                    .collect();
                let poster_images = convert_option_path_to_vec(d.cover.map(|p| p.url));
                MediaSearchItem {
                    identifier: d.id.to_string(),
                    title: d.name,
                    description: d.summary,
                    author_names: vec![],
                    publish_date: d.first_release_date.map(|d| d.date_naive()),
                    publish_year: d.first_release_date.map(|d| d.year()),
                    video_game_specifics: Some(VideoGameSpecifics {
                        genres: d
                            .genres
                            .unwrap_or_default()
                            .into_iter()
                            .map(|g| g.name)
                            .collect(),
                    }),
                    movie_specifics: None,
                    book_specifics: None,
                    show_specifics: None,
                    poster_images,
                    backdrop_images,
                }
            })
            .collect::<Vec<_>>();
        Ok(MediaSearchResults { total, items: resp })
    }

    fn get_cover_image_url(&self, c: &str) -> String {
        format!("{}{}{}", self.image_url, "original", c)
    }
}
