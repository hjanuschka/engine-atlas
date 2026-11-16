# Engine Atlas

Opt-in map of Chromium, Firefox, WebKit and DevTools contributors. See [spec.md](spec.md) for the product and security design.

## Local development

Requires Node 26 and Yarn classic (1.x). `.mise.toml` pins a Node version with Yarn available on this machine.

```sh
yarn install
yarn start
```

Open http://localhost:4317. No map account, API key, credit card, or Google billing required. The globe uses [MapLibre GL JS](https://maplibre.org/) with [OpenFreeMap's public tiles](https://openfreemap.org/) and its dark style. OpenFreeMap says its public instance has no map-view/request limit and requires no registration; it is donation-funded and has **no SLA**. Map data comes from OpenStreetMap. Attribution is displayed on the map. Tile requests go directly from visitors' browsers to OpenFreeMap/Cloudflare; disclose this in the site's privacy notice before launch. Do not bulk-download tiles. If availability becomes critical, host tiles or switch providers.

City search uses the public OpenStreetMap Nominatim service through our server, at no more than one upstream request per second. Its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) requires attribution, an identifiable app, and limited use; if search demand grows, use a dedicated or self-hosted geocoder. The public map and search are separate services with separate policies.

`yarn start` runs the server and daily Chromium/WebKit/DevTools refresh worker together. Backend edits restart the server; frontend edits reload the browser. Initial downloads require access to chromium.googlesource.com and raw.githubusercontent.com. Run `yarn refresh` to refresh all roster sources manually. Firefox eligibility is checked against exact commit-author emails in the public `mozilla/gecko-dev` mirror when a link is requested (including imported WPT commits); positive results are cached for one day and negative results for one hour. Mozilla's `AUTHORS` points to a credits page, not an email roster. GitHub search has API rate limits; set `GITHUB_TOKEN` if needed (server-side only).

Enter your email once. The server checks all four sources before sending a link, and a single verified profile gets every matching project badge. The email itself is never published. If GitHub's Firefox lookup is temporarily unavailable, roster matches (Chromium/WebKit/DevTools) can still receive a link; request another later to add the missing badge. Local emails are written to `data/mail/`, never sent. Open http://localhost:4317/magic-links to see them (development only, accessible from the local machine). Follow a link to test create/edit; request another after the session expires.

## Docker

```sh
docker compose up --build -d
```

### Production deploy (chrome2 / atlas.januschka.com)

The repo is checked out at `~/my-host/engine-atlas` and wired into the shared `~/my-host/docker-compose.yml` (services `engine-atlas` + `engine-atlas-refresh`, named volume `engine-atlas-data`, Caddy site `atlas.januschka.com` → `engine-atlas:3000`). SES credentials live in `~/my-host/.env` as `ATLAS_*` vars.

```sh
cd ~/my-host/engine-atlas && git pull
cd ~/my-host && docker compose build engine-atlas && docker compose up -d engine-atlas engine-atlas-refresh
```


Production: set `SITE_URL=https://your-domain`, `MAIL_MODE=ses`, `SES_REGION`, and `SES_FROM` (SES verified sender). Use an AWS role where possible, or inject AWS credentials at runtime via a secret manager. Put TLS/reverse proxy in front of the localhost-bound web port. SES sandbox only delivers to verified recipients; request production access before launch. `docker compose exec web node refresh.js` triggers a manual roster refresh. Back up the persistent `app-data` volume. Never expose `data/mail` publicly.

No profile is generated from contribution lists; the map starts empty. Public location coordinates should be city centers, not exact addresses.
