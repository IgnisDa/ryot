use std::sync::Arc;

use anyhow::anyhow;
use async_graphql::Result;
use enum_models::MediaSource;
use media_models::{MetadataLookupResponse, TmdbMetadataLookupResult, UniqueMediaIdentifier};
use providers::tmdb::TmdbService;
use supporting_service::SupportingService;

pub async fn metadata_lookup(
    ss: &Arc<SupportingService>,
    title: String,
) -> Result<MetadataLookupResponse> {
    let tmdb_service = TmdbService::new(ss.clone()).await;

    let search_results = tmdb_service
        .multi_search(&title)
        .await
        .map_err(|e| anyhow!("TMDB search failed: {}", e))?;

    if search_results.is_empty() {
        return Err(anyhow!("No media found for title: {}", title).into());
    }

    let best_match = find_best_match(&search_results)?;

    let data = UniqueMediaIdentifier {
        lot: best_match.lot,
        source: MediaSource::Tmdb,
        identifier: best_match.identifier.clone(),
    };

    let show_information = None;

    Ok(MetadataLookupResponse {
        data,
        show_information,
    })
}

fn find_best_match(results: &[TmdbMetadataLookupResult]) -> Result<&TmdbMetadataLookupResult> {
    results
        .first()
        .ok_or_else(|| anyhow!("No valid results found").into())
}
