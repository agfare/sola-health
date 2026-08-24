import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { defineConfig } from "vite";

const BUILD_OUT_DIR = "dist";

function htmlPartialsPlugin() {
  const includePattern = /<!--\s*@include\s+(.+?)\s*-->/g;
  const projectRoot = resolve(process.cwd());

  async function resolveIncludes(
    template,
    importer = "index.html",
    seen = new Set(),
  ) {
    const matches = Array.from(template.matchAll(includePattern));
    if (!matches.length) {
      return template;
    }

    let output = template;

    for (const match of matches) {
      const [directive, includePath] = match;
      const normalizedPath = includePath.trim();
      const absolutePath = resolve(projectRoot, normalizedPath);
      const chainKey = `${importer} -> ${normalizedPath}`;

      if (seen.has(absolutePath)) {
        throw new Error(`Circular partial include detected: ${chainKey}`);
      }

      if (!existsSync(absolutePath)) {
        throw new Error(`Partial not found: ${normalizedPath}`);
      }

      seen.add(absolutePath);
      const partialContent = await readFile(absolutePath, "utf8");
      const resolvedPartial = await resolveIncludes(
        partialContent,
        normalizedPath,
        seen,
      );
      seen.delete(absolutePath);
      output = output.replace(directive, resolvedPartial);
    }

    return output;
  }

  return {
    name: "html-partials",
    enforce: "pre",
    async transformIndexHtml(html) {
      return resolveIncludes(html);
    },
  };
}

/** After build, <img src="./assets/images/*.png"> (or legacy ./src/assets/images/) → WebP under dist/images. */
function htmlSourcePngToWebpPlugin() {
  const projectRoot = resolve(process.cwd());
  const sourceImagesDir = join(projectRoot, "src/assets/images");
  let buildOutDir;

  return {
    name: "html-source-png-to-webp",
    apply: "build",
    configResolved(config) {
      buildOutDir = resolve(config.root, config.build.outDir);
    },
    async writeBundle() {
      const htmlPath = join(buildOutDir, "index.html");
      if (!existsSync(htmlPath)) {
        return;
      }

      let html = await readFile(htmlPath, "utf8");
      const re =
        /src=(["'])(?:\.\/)?(?:src\/)?assets\/images\/([^"']+\.png)\1/g;
      const matches = [...html.matchAll(re)];
      if (matches.length === 0) {
        return;
      }

      const distImagesDir = join(buildOutDir, "images");
      await mkdir(distImagesDir, { recursive: true });

      const uniqueRels = [...new Set(matches.map((m) => m[2]))];
      const relToAsset = new Map();

      for (const rel of uniqueRels) {
        const srcPath = join(sourceImagesDir, rel);
        if (!existsSync(srcPath)) {
          throw new Error(
            `Image not found for HTML reference: src/assets/images/${rel}`,
          );
        }

        const webpBuffer = await sharp(srcPath)
          .webp({ quality: 100 })
          .toBuffer();
        const hash = createHash("sha256")
          .update(webpBuffer)
          .digest("hex")
          .slice(0, 8);
        const base = rel.replace(/\.png$/i, "");
        const outName = `${base}-${hash}.webp`;
        await writeFile(join(distImagesDir, outName), webpBuffer);
        relToAsset.set(rel, outName);
      }

      html = html.replace(re, (_full, quote, rel) => {
        const outName = relToAsset.get(rel);
        return `src=${quote}./images/${outName}${quote}`;
      });

      await writeFile(htmlPath, html, "utf8");
    },
  };
}

async function listDistTextAssetPaths(outDir) {
  const paths = [];
  const indexHtml = join(outDir, "index.html");
  if (existsSync(indexHtml)) {
    paths.push(indexHtml);
  }

  const entries = await readdir(outDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (/\.(css|js)$/.test(entry.name)) {
      paths.push(join(outDir, entry.name));
    }
  }

  return paths;
}

/** PNGs in dist/images (e.g. from CSS) → WebP; updates references in index.html and root-level CSS/JS. */
function distPngToWebpPlugin() {
  let outDir;

  return {
    name: "dist-png-to-webp",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const imagesDir = join(outDir, "images");
      if (!existsSync(imagesDir)) {
        return;
      }

      const pngFiles = (await readdir(imagesDir)).filter((f) =>
        f.toLowerCase().endsWith(".png"),
      );

      if (pngFiles.length === 0) {
        return;
      }

      const replacements = [];

      for (const pngFile of pngFiles) {
        const pngPath = join(imagesDir, pngFile);
        const webpBuffer = await sharp(pngPath)
          .webp({ quality: 100 })
          .toBuffer();
        const contentHash = createHash("sha256")
          .update(webpBuffer)
          .digest("hex")
          .slice(0, 8);
        const newName = `${pngFile.replace(/\.png$/i, "")}-${contentHash}.webp`;
        await writeFile(join(imagesDir, newName), webpBuffer);
        replacements.push({ oldFile: pngFile, newFile: newName });
      }

      const textPaths = await listDistTextAssetPaths(outDir);

      for (const textPath of textPaths) {
        let text = await readFile(textPath, "utf8");
        let changed = false;

        for (const { oldFile, newFile } of replacements) {
          if (text.includes(oldFile)) {
            text = text.split(oldFile).join(newFile);
            changed = true;
          }
        }

        if (changed) {
          await writeFile(textPath, text, "utf8");
        }
      }

      for (const { oldFile } of replacements) {
        await rm(join(imagesDir, oldFile), { force: true });
      }
    },
  };
}

function rasterAssetFileNames(assetInfo) {
  const name = assetInfo.names?.[0] ?? assetInfo.name ?? "";
  const ext = extname(name).toLowerCase();

  if ([".woff", ".woff2", ".ttf", ".otf", ".eot"].includes(ext)) {
    return "fonts/[name]-[hash][extname]";
  }

  if (
    [".png", ".webp", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".avif"].includes(
      ext,
    )
  ) {
    return "images/[name]-[hash][extname]";
  }

  if (ext === ".css") {
    return "[name]-[hash][extname]";
  }

  return "[name]-[hash][extname]";
}

export default defineConfig({
  root: "src",
  publicDir: "../public",
  base: "./",
  plugins: [
    htmlPartialsPlugin(),
    htmlSourcePngToWebpPlugin(),
    distPngToWebpPlugin(),
  ],
  server: {
    open: true,
  },
  build: {
    outDir: `../${BUILD_OUT_DIR}`,
    emptyOutDir: true,
    assetsDir: "",
    rollupOptions: {
      output: {
        entryFileNames: "[name]-[hash].js",
        chunkFileNames: "[name]-[hash].js",
        assetFileNames: rasterAssetFileNames,
      },
    },
  },
});
