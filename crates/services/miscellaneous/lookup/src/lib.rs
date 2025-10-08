use std::sync::Arc;

use anyhow::Result;
use common_models::MetadataLookupCacheInput;
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, CachedResponse};
use enum_models::{MediaLot, MediaSource};
use extractors::{extract_base_title, extract_season_episode, extract_year_from_title};
use matching::find_best_match;
use media_models::{
    MetadataLookupFoundResult, MetadataLookupNotFound, MetadataLookupResponse,
    SeenShowExtraInformation, TmdbMetadataLookupResult, UniqueMediaIdentifier,
};
use supporting_service::SupportingService;
use tmdb_provider::TmdbService;

mod extractors;
mod matching;
mod patterns;
#[cfg(test)]
mod tests;

async fn smart_search(
    tmdb_service: &TmdbService,
    title: &str,
) -> Result<Vec<TmdbMetadataLookupResult>> {
    let mut queries = Vec::with_capacity(2);

    let trimmed_title = title.trim();
    if !trimmed_title.is_empty() {
        queries.push(trimmed_title.to_string());
    }

    let base_title = extract_base_title(trimmed_title);
    if !base_title.is_empty()
        && !queries
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(base_title))
    {
        queries.push(base_title);
    }

    let mut last_error = None;

    for query in queries {
        match tmdb_service.multi_search(&query).await {
            Ok(results) if !results.is_empty() => return Ok(results),
            Ok(_) => {}
            Err(err) => last_error = Some(err),
        }
    }

    if let Some(err) = last_error {
        return Err(err);
    }

    Ok(vec![])
}

fn extract_show_information(title: &str, media_lot: &MediaLot) -> Option<SeenShowExtraInformation> {
    if !matches!(media_lot, MediaLot::Show) {
        return None;
    }

    extract_season_episode(title)
}

pub async fn metadata_lookup(
    ss: &Arc<SupportingService>,
    title: String,
) -> Result<CachedResponse<MetadataLookupResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::MetadataLookup(MetadataLookupCacheInput {
            title: title.clone(),
        }),
        ApplicationCacheValue::MetadataLookup,
        move || async move {
            let tmdb_service = TmdbService::new(ss.clone()).await?;
            let search_results = smart_search(&tmdb_service, &title).await?;

            if search_results.is_empty() {
                return Ok(MetadataLookupResponse::NotFound(MetadataLookupNotFound {
                    not_found: true,
                }));
            }

            let publish_year = extract_year_from_title(&title);
            let best_match = find_best_match(&search_results, &title, publish_year)?;

            let data = UniqueMediaIdentifier {
                lot: best_match.lot,
                source: MediaSource::Tmdb,
                identifier: best_match.identifier.clone(),
            };

            let show_information = extract_show_information(&title, &best_match.lot);

            Ok(MetadataLookupResponse::Found(MetadataLookupFoundResult {
                data,
                show_information,
            }))
        },
    )
    .await
}
