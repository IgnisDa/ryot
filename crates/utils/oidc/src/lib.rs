use std::sync::Arc;

use common_utils::{FRONTEND_OAUTH_ENDPOINT, ryot_log};
use config_definition::AppConfig;
use openidconnect::{
    ClientId, ClientSecret, EmptyAdditionalClaims, EndpointMaybeSet, EndpointNotSet, EndpointSet,
    IssuerUrl, RedirectUrl, StandardErrorResponse,
    core::{
        CoreAuthDisplay, CoreAuthPrompt, CoreClient, CoreErrorResponseType, CoreGenderClaim,
        CoreJsonWebKey, CoreJweContentEncryptionAlgorithm, CoreProviderMetadata,
        CoreRevocableToken, CoreRevocationErrorResponse, CoreTokenIntrospectionResponse,
        CoreTokenResponse,
    },
    reqwest::{Client as ReqwestClient, ClientBuilder, redirect::Policy},
};

pub type ApplicationOidcClient<
    HasAuthUrl = EndpointSet,
    HasDeviceAuthUrl = EndpointNotSet,
    HasIntrospectionUrl = EndpointNotSet,
    HasRevocationUrl = EndpointNotSet,
    HasTokenUrl = EndpointMaybeSet,
    HasUserInfoUrl = EndpointMaybeSet,
> = openidconnect::Client<
    EmptyAdditionalClaims,
    CoreAuthDisplay,
    CoreGenderClaim,
    CoreJweContentEncryptionAlgorithm,
    CoreJsonWebKey,
    CoreAuthPrompt,
    StandardErrorResponse<CoreErrorResponseType>,
    CoreTokenResponse,
    CoreTokenIntrospectionResponse,
    CoreRevocableToken,
    CoreRevocationErrorResponse,
    HasAuthUrl,
    HasDeviceAuthUrl,
    HasIntrospectionUrl,
    HasRevocationUrl,
    HasTokenUrl,
    HasUserInfoUrl,
>;

pub async fn create_oidc_client(
    config: &Arc<AppConfig>,
) -> Option<(ReqwestClient, ApplicationOidcClient)> {
    let redirect_url = match RedirectUrl::new(config.frontend.url.clone() + FRONTEND_OAUTH_ENDPOINT)
    {
        Ok(url) => url,
        Err(e) => {
            ryot_log!(debug, "Error while processing OIDC redirect url: {:?}", e);
            return None;
        }
    };

    let issuer_url = match IssuerUrl::new(config.server.oidc.issuer_url.clone()) {
        Ok(url) => url,
        Err(e) => {
            ryot_log!(debug, "Error while processing OIDC issuer url: {:?}", e);
            return None;
        }
    };

    let async_http_client = match ClientBuilder::new().redirect(Policy::none()).build() {
        Ok(client) => client,
        Err(e) => {
            ryot_log!(debug, "Error while building HTTP client: {:?}", e);
            return None;
        }
    };

    let provider_metadata =
        match CoreProviderMetadata::discover_async(issuer_url, &async_http_client).await {
            Ok(metadata) => metadata,
            Err(e) => {
                ryot_log!(debug, "Error while creating OIDC client: {:?}", e);
                return None;
            }
        };

    let core_client = CoreClient::from_provider_metadata(
        provider_metadata,
        ClientId::new(config.server.oidc.client_id.clone()),
        match config.server.oidc.client_secret.clone() {
            secret if !secret.is_empty() => Some(ClientSecret::new(secret)),
            _ => None,
        },
    )
    .set_redirect_uri(redirect_url);

    Some((async_http_client, core_client))
}
