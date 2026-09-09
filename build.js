// build.js — prerender step. Zero dependencies. Node >= 18.
//
// Reads index.html, replaces every empty `<div id="<name>-placeholder"></div>`
// with the contents of `components/<name>.html`, strips HTML comments, and
// writes the result plus css/, js/ and portfolio.html into dist/.
//
// components/*.html stay the single source of resume text. dist/ is a build
// artifact (gitignored) and is what deploy.yml syncs to S3.
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

function stripComments(html) {
    return html.replace(/<!--[\s\S]*?-->/g, "");
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
    const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const { html, filled } = inlineComponents(stripComments(index));

    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "index.html"), html.trimStart());

    for (const f of COPY_FILES) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
    for (const d of COPY_DIRS) copyDir(path.join(ROOT, d), path.join(OUT, d));

    console.log(`build: wrote ${path.relative(ROOT, OUT)}/index.html with ${filled.length} components inlined: ${filled.join(", ")}`);
}

main();
