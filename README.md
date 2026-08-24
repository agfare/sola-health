# Sola Health landing

Static marketing site: vanilla HTML/CSS/JS, bundled with **Vite 7**. Raster images are **PNG in the repo**; production output uses **WebP** (via Sharp in the build pipeline).

## Requirements

- **Node.js** — see [`.nvmrc`](.nvmrc) (native `--env-file-if-exists` is used for deploy).

## Scripts

```bash
npm install
npm run dev      # dev server (Vite root: src/)
npm run build    # production → ../dist from Vite root (repo dist/)
npm run preview  # serve dist locally
npm run deploy   # build + copy dist contents into DEPLOY_TARGET (see below)
```

## Project layout

| Path | Role |
|------|------|
| [`src/index.html`](src/index.html) | Entry HTML; composes sections with `<!-- @include ... -->` |
| [`src/style.css`](src/style.css) | Global styles + `@import` of component CSS |
| [`src/main.js`](src/main.js) | Small client script (e.g. email form) |
| [`src/components/<name>/`](src/components/) | Each block: `<name>.html` + `<name>.css` |
| [`src/assets/images/`](src/assets/images/) | Source PNGs for `<img>` and CSS backgrounds |
| [`src/assets/fonts/`](src/assets/fonts/) | Web font files (`.woff2`) |
| [`public/`](public/) | Copied as-is to dist root (`favicon.png`, `robots.txt`, `sitemap.xml`, etc.) |

Vite is configured with **`root: "src"`**, **`publicDir: "../public"`**, and **`build.outDir: "../dist"`** so the repo root still holds `vite.config.js`, `package.json`, and `dist/`.

## HTML partials

Partials are inlined by a custom Vite plugin before build, for example:

```html
<!-- @include src/components/hero/hero.html -->
```

Paths in `@include` are relative to the **repository root** (not `src/`).

## Production build (`dist/`)

There is **no** `assets/` folder. Output is:

- **`index.html`** at the root of `dist/`
- **Hashed JS and CSS** at the root of `dist/` (e.g. `index-*.js`, `index-*.css`)
- **`fonts/`** — emitted font files
- **`images/`** — raster/vector assets and WebP produced from PNG during build

In development, image URLs point at **PNG under `src/assets/images/`**. In `dist/`, HTML references **`./images/*.webp`** where applicable; CSS backgrounds from PNG are converted to WebP in the same pass.

## Deploy

`npm run deploy` runs **`npm run build`**, then [`scripts/deploy.mjs`](scripts/deploy.mjs):

1. **Clears** `DEPLOY_TARGET` (each child is removed; **`.git` is kept** if the target is the repo root) and copies **everything inside `dist/`** into it.
2. Finds the **Git root** (walks up from `DEPLOY_TARGET` until `.git` exists), runs **`git add`** for that path only (or **`git add -A`** when the target is the repo root), then **`git commit -m "version <version>"`** using **`version`** from this project’s **`package.json`**, then **`git push`** from that Git root.

If there is nothing new to commit, commit and push are skipped. The target directory must lie **inside** a Git clone with a configured remote for **`git push`** to succeed.

Set the target in a **`.env`** file at the repo root (gitignored), or in the shell:

```env
DEPLOY_TARGET=/absolute/or/relative/path/to/other-project/docs
```

Loading uses Node’s **`--env-file-if-exists=.env`** (see `package.json`). If `.env` is missing, you can still run:

```bash
DEPLOY_TARGET=/path/to/target npm run deploy
```
