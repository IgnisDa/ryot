FROM ignisda/archlinux:latest

RUN npm install --global yaml-language-server@next
RUN paru -Syy --noconfirm caddy postgresql zip
RUN cargo binstall sea-orm-cli --locked --secure --no-confirm
RUN curl -L https://fly.io/install.sh | sh
RUN fish_add_path -Ua "/home/$USERNAME/.fly/bin"
RUN curl -sSL https://install.python-poetry.org | python3 -
