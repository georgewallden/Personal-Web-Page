// scripts/check-resume-html.js — build-time assertion. Zero dependencies.
//
// Reads the built resume HTML and asserts that every string listed in
// scripts/resume-checklist.json is present. Exits non-zero if any is missing,
// which fails the deploy. The checklist is a test fixture of substrings, not
// a copy of the resume — components/*.html remain the only source of text.
//
// Usage:  node scripts/check-resume-html.js [path/to/index.html]
//         default path: dist/index.html

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const target = path.resolve(ROOT, process.argv[2] || "dist/index.html");
const checklistPath = path.join(__dirname, "resume-checklist.json");

const checklist = JSON.parse(fs.readFileSync(checklistPath, "utf8"));
const html = fs.readFileSync(target, "utf8");

// Compare against text with tags removed so a string split by inline markup
// (e.g. <strong>) still matches, and against raw HTML for anything else.
const text = html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

let missing = 0;
let total = 0;
for (const [group, items] of Object.entries(checklist.required)) {
    for (const item of items) {
        total += 1;
        const ok = text.includes(item) || html.includes(item);
        if (!ok) {
            missing += 1;
            console.error(`MISSING [${group}]: ${item}`);
        }
    }
}

const minSkills = checklist.minSkills || 0;
const skillsFound = (checklist.required.skills || []).filter((s) => text.includes(s)).length;
if (skillsFound < minSkills) {
    missing += 1;
    console.error(`MISSING [skills]: only ${skillsFound} of required minimum ${minSkills} skills found`);
}

// --- v0.0.3: metadata assertions (title, description, Person JSON-LD) ---

function fail(msg) {
    missing += 1;
    console.error(`MISSING [metadata]: ${msg}`);
}

const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
if (!titleMatch) {
    fail("no <title> element found");
} else if (!titleMatch[1].includes("AI Application Engineer")) {
    fail(`<title> does not contain "AI Application Engineer" (got: ${titleMatch[1]})`);
}

const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/);
if (!descMatch) {
    fail('no <meta name="description"> found');
} else if (!descMatch[1].includes("AI Application Engineer")) {
    fail(`meta description does not contain "AI Application Engineer" (got: ${descMatch[1]})`);
}

const ldJsonBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
if (ldJsonBlocks.length !== 1) {
    fail(`expected exactly one application/ld+json block, found ${ldJsonBlocks.length}`);
} else {
    let parsed;
    try {
        parsed = JSON.parse(ldJsonBlocks[0][1]);
    } catch (e) {
        fail(`application/ld+json block does not parse: ${e.message}`);
    }
    if (parsed && parsed["@type"] !== "Person") {
        fail(`JSON-LD @type is "${parsed["@type"]}", expected "Person"`);
    }
}

if (missing > 0) {
    console.error(`check-resume-html: FAIL — ${missing} problem(s) in ${path.relative(ROOT, target)}`);
    process.exit(1);
}
console.log(`check-resume-html: OK — ${total} required strings + metadata checks present in ${path.relative(ROOT, target)} (${html.length} bytes)`);
