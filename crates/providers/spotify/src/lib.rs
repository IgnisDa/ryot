use std::sync::Arc;

use anyhow::{Result, bail};
use application_utils::get_base_http_client;
use async_trait::async_trait;
use common_models::{EntityAssets, PersonSourceSpecifics, SearchDetails};
use common_utils::{PAGE_SIZE, convert_date_to_year, convert_string_to_date};
use data_encoding::BASE64;
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::MetadataSearchSourceSpecifics;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, MetadataGroupPersonRelated, MetadataPersonRelated,
    PersonDetails, SearchResults,
};
use enum_models::{MediaLot, MediaSource};
use futures::try_join;
use media_models::{
    CommitMetadataGroupInput, MetadataDetails, MetadataGroupSearchItem, MetadataSearchItem,
    MusicSpecifics, PartialMetadataPerson, PartialMetadataWithoutId, PeopleSearchItem,
    UniqueMediaIdentifier,
};
use reqwest::{
    Client,
    header::{AUTHORIZATION, HeaderValue},
};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;
use traits::MediaProvider;

static SPOTIFY_TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
static SPOTIFY_API_URL: &str = "https://api.spotify.com/v1";

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SpotifyTokenResponse {
    access_token: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SpotifyTrack {
    id: String,
    name: String,
    explicit: Option<bool>,
    popularity: Option<i32>,
    duration_ms: Option<i32>,
    disc_number: Option<i32>,
    track_number: Option<i32>,
    album: Option<SpotifyAlbum>,
    artists: Option<Vec<SpotifyArtist>>,
    external_urls: Option<SpotifyExternalUrls>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SpotifyAlbum {
    id: Option<String>,
    name: Option<String>,
    images: Vec<SpotifyImage>,
    description: Option<String>,
    total_tracks: Option<usize>,
    release_date: Option<String>,
    external_urls: Option<SpotifyExternalUrls>,
    tracks: Option<SpotifyResponse<SpotifyTrack>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SpotifyArtist {
    id: String,
    name: String,
    genres: Option<Vec<String>>,
    images: Option<Vec<SpotifyImage>>,
    external_urls: Option<SpotifyExternalUrls>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SpotifyImage {
    url: String,
    width: Option<i32>,
    height: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SpotifyResponse<T> {
    total: i32,
    items: Vec<T>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SpotifySearchResponse {
    tracks: SpotifyResponse<SpotifyTrack>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SpotifyExternalUrls {
    spotify: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SpotifyAlbumSearchResponse {
    albums: SpotifyResponse<SpotifyAlbum>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SpotifyArtistSearchResponse {
    artists: SpotifyResponse<SpotifyArtist>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SpotifyArtistTopTracksResponse {
    tracks: Vec<SpotifyTrack>,
}

pub struct SpotifyService {
    client: Client,
}

async fn fetch_artist_albums(client: &Client, artist_id: &str) -> Result<Vec<SpotifyAlbum>> {
    let mut all_albums = Vec::new();
    let mut offset = 0;
    let limit = 50;

    loop {
        let response = client
            .get(format!("{SPOTIFY_API_URL}/artists/{artist_id}/albums"))
            .query(&[
                ("include_groups", "album,single"),
                ("limit", &limit.to_string()),
                ("offset", &offset.to_string()),
            ])
            .send()
            .await?;

        let albums_response: SpotifyResponse<SpotifyAlbum> = response.json().await?;

        if albums_response.items.is_empty() {
            break;
        }

        all_albums.extend(albums_response.items);

        if all_albums.len() >= albums_response.total as usize {
            break;
        }

        offset += limit;
    }

    Ok(all_albums)
}

async fn fetch_artist_top_tracks(client: &Client, artist_id: &str) -> Result<Vec<SpotifyTrack>> {
    let response = client
        .get(format!("{SPOTIFY_API_URL}/artists/{artist_id}/top-tracks"))
        .query(&[("market", "US")])
        .send()
        .await?;

    let top_tracks_response: SpotifyArtistTopTracksResponse = response.json().await?;
    Ok(top_tracks_response.tracks)
}

async fn get_spotify_access_token(
    config: &config_definition::SpotifyConfig,
    ss: &Arc<SupportingService>,
) -> Result<String> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::SpotifyAccessToken,
        ApplicationCacheValue::SpotifyAccessToken,
        || async {
            if config.client_id.is_empty() || config.client_secret.is_empty() {
                bail!("Spotify client ID or secret is not configured");
            }
            let credentials = format!("{}:{}", config.client_id, config.client_secret);
            let encoded_credentials = BASE64.encode(credentials.as_bytes());

            let response = Client::new()
                .post(SPOTIFY_TOKEN_URL)
                .header("Authorization", format!("Basic {encoded_credentials}"))
                .form(&[("grant_type", "client_credentials")])
                .send()
                .await?;

            let token_response: SpotifyTokenResponse = response.json().await?;

            Ok(token_response.access_token)
        },
    )
    .await
    .map(|c| c.response)
}

fn get_images_ordered_by_size(images: &[SpotifyImage]) -> Vec<String> {
    let mut sorted_images = images.to_vec();
    sorted_images.sort_by(|a, b| {
        let size_a = a.width.unwrap_or(0) * a.height.unwrap_or(0);
        let size_b = b.width.unwrap_or(0) * b.height.unwrap_or(0);
        size_b.cmp(&size_a)
    });
    sorted_images.iter().map(|img| img.url.clone()).collect()
}

fn get_first_image(images: &[SpotifyImage]) -> Option<String> {
    get_images_ordered_by_size(images).first().cloned()
}

impl SpotifyService {
    pub async fn new(
        config: &config_definition::SpotifyConfig,
        ss: Arc<SupportingService>,
    ) -> Result<Self> {
        let access_token = get_spotify_access_token(config, &ss).await?;
        let client = get_base_http_client(Some(vec![(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {access_token}"))?,
        )]));

        Ok(Self { client })
    }

    async fn search_spotify<T>(
        &self,
        query: &str,
        search_type: &str,
        page: Option<i32>,
    ) -> Result<(T, i32)>
    where
        T: for<'de> Deserialize<'de>,
    {
        let page = page.unwrap_or(1);
        let offset = (page - 1) * PAGE_SIZE;

        let response = self
            .client
            .get(format!("{SPOTIFY_API_URL}/search"))
            .query(&[
                ("q", query),
                ("type", search_type),
                ("offset", &offset.to_string()),
                ("limit", &PAGE_SIZE.to_string()),
            ])
            .send()
            .await?;

        let search_response: T = response.json().await?;
        Ok((search_response, page))
    }
}

#[async_trait]
impl MediaProvider for SpotifyService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let track_response = self
            .client
            .get(format!("{SPOTIFY_API_URL}/tracks/{identifier}"))
            .send()
            .await?;

        let track: SpotifyTrack = track_response.json().await?;

        let artists = track.artists.unwrap_or_default();
        let by_various_artists = artists.len() > 1;
        let people: Vec<PartialMetadataPerson> = artists
            .iter()
            .map(|artist| PartialMetadataPerson {
                name: artist.name.clone(),
                role: "Artist".to_string(),
                source: MediaSource::Spotify,
                identifier: artist.id.clone(),
                ..Default::default()
            })
            .collect();

        let album = track.album.as_ref().unwrap();
        let groups = vec![CommitMetadataGroupInput {
            image: get_first_image(&album.images),
            name: album.name.clone().unwrap_or_default(),
            unique: UniqueMediaIdentifier {
                lot: MediaLot::Music,
                source: MediaSource::Spotify,
                identifier: album.id.clone().unwrap_or_default(),
            },
            ..Default::default()
        }];

        let publish_date = album
            .release_date
            .as_ref()
            .and_then(|date_str| convert_string_to_date(date_str));
        let publish_year = album
            .release_date
            .as_ref()
            .and_then(|date| convert_date_to_year(date));

        let assets = EntityAssets {
            remote_images: get_images_ordered_by_size(&album.images),
            ..Default::default()
        };

        let music_specifics = MusicSpecifics {
            disc_number: track.disc_number,
            track_number: track.track_number,
            duration: track.duration_ms.map(|ms| ms / 1000),
            by_various_artists: Some(by_various_artists),
            ..Default::default()
        };

        Ok(MetadataDetails {
            assets,
            people,
            groups,
            publish_year,
            publish_date,
            title: track.name,
            lot: MediaLot::Music,
            identifier: track.id,
            source: MediaSource::Spotify,
            is_nsfw: track.explicit,
            music_specifics: Some(music_specifics),
            source_url: track
                .external_urls
                .as_ref()
                .map(|urls| urls.spotify.clone()),
            provider_rating: track.popularity.map(Decimal::from),
            ..Default::default()
        })
    }

    async fn metadata_search(
        &self,
        page: i32,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let (search_response, page): (SpotifySearchResponse, i32) =
            self.search_spotify(query, "track", Some(page)).await?;

        let next_page = (search_response.tracks.total > (page * PAGE_SIZE)).then(|| page + 1);

        let items = search_response
            .tracks
            .items
            .into_iter()
            .map(|track| {
                let album = track.album.as_ref();
                let publish_year = album
                    .and_then(|a| a.release_date.as_ref())
                    .and_then(|date| convert_date_to_year(date));

                MetadataSearchItem {
                    publish_year,
                    title: track.name,
                    identifier: track.id,
                    image: album.and_then(|a| get_first_image(&a.images)),
                }
            })
            .collect();

        Ok(SearchResults {
            items,
            details: SearchDetails {
                next_page,
                total_items: search_response.tracks.total,
            },
        })
    }

    async fn metadata_group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        let response = self
            .client
            .get(format!("{SPOTIFY_API_URL}/albums/{identifier}"))
            .send()
            .await?;

        let album: SpotifyAlbum = response.json().await?;

        let publish_year = album
            .release_date
            .as_ref()
            .and_then(|date| convert_date_to_year(date));

        let items: Vec<PartialMetadataWithoutId> = album
            .tracks
            .as_ref()
            .map(|t| &t.items)
            .unwrap_or(&vec![])
            .iter()
            .map(|track| PartialMetadataWithoutId {
                publish_year,
                lot: MediaLot::Music,
                title: track.name.clone(),
                identifier: track.id.clone(),
                source: MediaSource::Spotify,
                image: get_first_image(&album.images),
            })
            .collect();

        let group = MetadataGroupWithoutId {
            lot: MediaLot::Music,
            source: MediaSource::Spotify,
            description: album.description.clone(),
            title: album.name.clone().unwrap_or_default(),
            parts: album.total_tracks.unwrap_or(0) as i32,
            identifier: album.id.clone().unwrap_or_default(),
            source_url: album
                .external_urls
                .as_ref()
                .map(|urls| urls.spotify.clone()),
            assets: EntityAssets {
                remote_images: get_images_ordered_by_size(&album.images),
                ..Default::default()
            },
        };

        Ok((group, items))
    }

    async fn metadata_group_search(
        &self,
        page: i32,
        query: &str,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataGroupSearchItem>> {
        let (search_response, page): (SpotifyAlbumSearchResponse, i32) =
            self.search_spotify(query, "album", Some(page)).await?;

        let next_page = (search_response.albums.total > (page * PAGE_SIZE)).then(|| page + 1);

        let items = search_response
            .albums
            .items
            .into_iter()
            .map(|album| MetadataGroupSearchItem {
                name: album.name.clone().unwrap_or_default(),
                identifier: album.id.clone().unwrap_or_default(),
                parts: album.total_tracks,
                image: get_first_image(&album.images),
            })
            .collect();

        Ok(SearchResults {
            items,
            details: SearchDetails {
                next_page,
                total_items: search_response.albums.total,
            },
        })
    }

    async fn person_details(
        &self,
        identifier: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        let (artist, albums, top_tracks) = try_join!(
            async {
                let response = self
                    .client
                    .get(format!("{SPOTIFY_API_URL}/artists/{identifier}"))
                    .send()
                    .await?;
                let artist: SpotifyArtist = response.json().await?;
                Ok(artist)
            },
            fetch_artist_albums(&self.client, identifier),
            fetch_artist_top_tracks(&self.client, identifier)
        )?;

        let description = artist.genres.as_ref().and_then(|genres| {
            if genres.is_empty() {
                None
            } else {
                Some(format!("Genres: {}", genres.join(", ")))
            }
        });

        let assets = EntityAssets {
            remote_images: artist
                .images
                .as_ref()
                .map_or(vec![], |images| get_images_ordered_by_size(images)),
            ..Default::default()
        };

        let related_metadata_groups: Vec<MetadataGroupPersonRelated> = albums
            .into_iter()
            .map(|album| MetadataGroupPersonRelated {
                role: "Artist".to_string(),
                metadata_group: MetadataGroupWithoutId {
                    lot: MediaLot::Music,
                    source: MediaSource::Spotify,
                    title: album.name.clone().unwrap_or_default(),
                    identifier: album.id.clone().unwrap_or_default(),
                    parts: album.total_tracks.unwrap_or(0) as i32,
                    assets: EntityAssets {
                        remote_images: get_images_ordered_by_size(&album.images),
                        ..Default::default()
                    },
                    source_url: None,
                    description: None,
                },
            })
            .collect();

        let related_metadata: Vec<MetadataPersonRelated> = top_tracks
            .into_iter()
            .map(|track| {
                let album = track.album.as_ref();
                let publish_year = album
                    .and_then(|a| a.release_date.as_ref())
                    .and_then(|date| convert_date_to_year(date));

                MetadataPersonRelated {
                    role: "Artist".to_string(),
                    metadata: PartialMetadataWithoutId {
                        lot: MediaLot::Music,
                        publish_year,
                        title: track.name.clone(),
                        identifier: track.id.clone(),
                        source: MediaSource::Spotify,
                        image: album.and_then(|a| get_first_image(&a.images)),
                    },
                    ..Default::default()
                }
            })
            .collect();

        Ok(PersonDetails {
            assets,
            description,
            related_metadata,
            name: artist.name,
            identifier: artist.id,
            related_metadata_groups,
            source: MediaSource::Spotify,
            source_url: artist
                .external_urls
                .as_ref()
                .map(|urls| urls.spotify.clone()),
            ..Default::default()
        })
    }

    async fn people_search(
        &self,
        page: i32,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let (search_response, page): (SpotifyArtistSearchResponse, i32) =
            self.search_spotify(query, "artist", Some(page)).await?;

        let next_page = (search_response.artists.total > (page * PAGE_SIZE)).then(|| page + 1);

        let items = search_response
            .artists
            .items
            .into_iter()
            .map(|artist| PeopleSearchItem {
                name: artist.name.clone(),
                identifier: artist.id.clone(),
                image: artist
                    .images
                    .as_ref()
                    .and_then(|images| get_first_image(images)),
                ..Default::default()
            })
            .collect();

        Ok(SearchResults {
            items,
            details: SearchDetails {
                next_page,
                total_items: search_response.artists.total,
            },
        })
    }
}
