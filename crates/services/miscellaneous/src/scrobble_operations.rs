use async_graphql::Result;
use media_models::{MetadataLookupInput, UniqueMediaIdentifier};
use supporting_service::SupportingService;

pub async fn metadata_lookup(
    ss: &SupportingService,
    input: MetadataLookupInput,
) -> Result<UniqueMediaIdentifier> {
    todo!()
}
