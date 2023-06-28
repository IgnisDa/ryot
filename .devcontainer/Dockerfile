FROM ignisda/archlinux:latest

RUN paru -Syy --noconfirm caddy
RUN cargo binstall sea-orm-cli cargo-dist --locked --secure --no-confirm
RUN curl -L https://fly.io/install.sh | sh
RUN fish_add_path -Ua "/home/$USERNAME/.fly/bin"
RUN proto install-global node @volar/shared @volar/vue-language-server vscode-languageserver-types
