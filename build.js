// build.js — prerender step. Zero dependencies. Node >= 18.
//
// Reads index.html, replaces every empty `<div id="<name>-placeholder"></div>`
// with the contents of `components/<name>.html`, strips HTML comments, injects
// page metadata (title/description/OpenGraph/Twitter/canonical/Person JSON-LD)
// from metadata.json, generates robots.txt + sitemap.xml, and writes the
// result plus css/, js/ and portfolio.html into dist/.
//
// components/*.html and metadata.json are the single sources of truth for
// resume text and page metadata, respectively. dist/ is a build artifact
// (gitignored) and is what deploy.yml syncs to S3.
//
// Usage:  node build.js            -> writes dist/
//         node build.js --out X    -> writes X/

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const outArg = process.argv.indexOf("--out");
const OUT = path.resolve(ROOT, outArg > -1 ? process.argv[outArg + 1] : "dist");

const COPY_FILES = ["portfolio.html"];
const COPY_DIRS = ["css", "js"];
const META_MARKER = "<!-- meta:head — build.js injects description/OpenGraph/Twitter/canonical/JSON-LD here from metadata.json. Unbuilt preview has no extra tags, only this fallback title. -->";
// stripComments removes ALL HTML comments, including commented-out
// placeholders (e.g. summary, hidden on purpose since v0.0.2) and the
// meta:head marker itself. Swap the marker for this sentinel before
// stripping so it survives, then swap it back before injecting the head
// block — that way stripComments always runs first, exactly like v0.0.2.
const META_SENTINEL = "META_HEAD_SENTINEL";

function stripComments(html) {
    return html.replace(/<!--[\s\S]*?-->/g, "");
}

function escapeAttr(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function loadMetadata() {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "metadata.json"), "utf8"));
}

function buildPersonJsonLd(meta) {
    const person = {
        "@context": "https://schema.org",
        "@type": "Person",
        name: meta.name,
        jobTitle: meta.jobTitle,
        url: meta.siteUrl,
        sameAs: meta.sameAs,
        knowsAbout: meta.knowsAbout,
        hasCredential: meta.hasCredential.map((c) => ({
            "@type": "EducationalOccupationalCredential",
            name: c,
        })),
    };
    // JSON never legitimately contains "</script" here, but escape defensively
    // so the payload can never break out of the script tag.
    return JSON.stringify(person, null, 2).replace(/<\//g, "<\\/");
}

function buildHeadBlock(meta) {
    const title = escapeAttr(meta.title);
    const description = escapeAttr(meta.description);
    const url = escapeAttr(meta.siteUrl);
    return [
        `<meta name="description" content="${description}">`,
        `<link rel="canonical" href="${url}">`,
        `<meta property="og:type" content="profile">`,
        `<meta property="og:title" content="${title}">`,
        `<meta property="og:description" content="${description}">`,
        `<meta property="og:url" content="${url}">`,
        `<meta name="twitter:card" content="summary">`,
        `<meta name="twitter:title" content="${title}">`,
        `<meta name="twitter:description" content="${description}">`,
        `<script type="application/ld+json">`,
        buildPersonJsonLd(meta),
        `</script>`,
    ].join("\n    ");
}

function inlineComponents(indexHtml) {
    const placeholderRe = /<div id="([a-z0-9-]+)-placeholder"><\/div>/g;
    const filled = [];
    const out = indexHtml.replace(placeholderRe, (match, name) => {
        const file = path.join(ROOT, "components", `${name}.html`);
        if (!fs.existsSync(file)) {
            throw new Error(`build: placeholder "${name}" has no components/${name}.html`);
        }
        const fragment = stripComments(fs.readFileSync(file, "utf8")).trim();
        filled.push(name);
        return `<div id="${name}-placeholder">\n${fragment}\n</div>`;
    });
    if (filled.length === 0) {
        throw new Error("build: no placeholders found in index.html");
    }
    return { html: out, filled };
}

function applyMetadata(html, meta) {
    if (!html.includes(META_SENTINEL)) {
        throw new Error("build: index.html is missing the meta:head marker comment");
    }
    let out = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeAttr(meta.title)}</title>`);
    out = out.replace(META_SENTINEL, buildHeadBlock(meta));
    return out;
}

function buildRobotsTxt(meta) {
    return [
        "User-agent: *",
        "Allow: /",
        "",
        `Sitemap: ${meta.siteUrl}sitemap.xml`,
        "",
    ].join("\n");
}

function buildSitemapXml(meta) {
    const today = new Date().toISOString().slice(0, 10);
    return [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
        `  <url>`,
        `    <loc>${escapeAttr(meta.siteUrl)}</loc>`,
        `    <lastmod>${today}</lastmod>`,
        `  </url>`,
        `</urlset>`,
        "",
    ].join("\n");
}

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
    }
}

function main() {
    const meta = loadMetadata();
    const rawIndex = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    // Protect the meta:head marker with a sentinel, then strip comments (this
    // is also what removes commented-out placeholders, e.g. summary — same
    // order v0.0.2 used), then inline components, then swap the sentinel for
    // the real head block last.
    const protectedIndex = rawIndex.replace(META_MARKER, META_SENTINEL);
    const stripped = stripComments(protectedIndex);
    const { html: withPlaceholders, filled } = inlineComponents(stripped);
    const html = applyMetadata(withPlaceholders, meta);

    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "index.html"), html.trimStart());
    fs.writeFileSync(path.join(OUT, "robots.txt"), buildRobotsTxt(meta));
    fs.writeFileSync(path.join(OUT, "sitemap.xml"), buildSitemapXml(meta));

    for (const f of COPY_FILES) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
    for (const d of COPY_DIRS) copyDir(path.join(ROOT, d), path.join(OUT, d));

    console.log(`build: wrote ${path.relative(ROOT, OUT)}/index.html with ${filled.length} components inlined: ${filled.join(", ")}`);
    console.log(`build: wrote ${path.relative(ROOT, OUT)}/robots.txt and sitemap.xml (${meta.siteUrl})`);
}

main();
