# Site recon — georgewallden.com (M00 v0.0.1)

Date: 2026-09-09. Investigation only; no source changes.

## 1. Stack, build, hosting, deploy

| Item | Finding | Evidence |
|---|---|---|
| Framework | None. Hand-written HTML + CSS + vanilla JS. No package.json, no bundler, no router. | `git ls-files` — 27 tracked files, no `package.json`, no `node_modules` |
| Client-side assembly | `index.html` holds 9 empty placeholder `<div>`s; `js/app.js` fetches `components/*.html` on `DOMContentLoaded` and sets `innerHTML`. | `index.html:18-31`, `js/app.js:5-42` |
| Hosting | S3 bucket `www.georgewallden.com` (private, OAC only) behind CloudFront `E2ZL7HX4ZYZ96R`, aliases `www.georgewallden.com` + `georgewallden.com`, `DefaultRootObject=index.html`. No S3 static-website config. No custom error responses. | CloudFront `GetDistributionConfig`; S3 `GetBucketPolicy` (Allow `s3:GetObject` only to that distribution), `GetPublicAccessBlock` all true, `GetBucketWebsite` → `NoSuchWebsiteConfiguration` |
| Other behaviors on same distribution | `/BudgetApp/*`, `/BudgetApp-dev/*` (S3 + CloudFront Function `budgetapp-spa-router`), `/personal-os*` (custom origin `personal-os.georgewallden.com`). Must not be disturbed. | same `GetDistributionConfig` |
| Deploy | GitHub Actions on push to `main`: `aws s3 sync . s3://www.georgewallden.com --delete` with excludes for `.git`, `.github`, `utils`, `llm-detector`, `BudgetApp*`; then Lambda code update; then `create-invalidation --paths "/*"`. **The repo root IS the deploy artifact — no build step exists.** | `.github/workflows/deploy.yml:23-45` |
| Local tooling on this machine | Node v22.18.0, Python 3.12.1 (both usable in a future build step; GitHub `ubuntu-latest` also ships both). | `node --version`, `python --version` |

## 2. Resume source file and content model

- **Source = `components/*.html`** (9 fragments). Resume text lives in static HTML fragments, not in JS/TS/data. Fragments:
  `header.html`, `contact-info.html`, `education.html`, `certifications.html`, `capabilities.html`, `core-technologies.html`, `experience.html`, `projects.html`, `technical-skills.html`, plus `summary.html` (fetched by `app.js:32` but its placeholder is commented out at `index.html:28` → console warning, never rendered).
- **Included how:** `js/app.js:25-36` maps filename → placeholder id; `app.js:41` fetches `components/<file>` relative to page URL, so the fragments are also publicly fetchable (verified: `curl .../components/experience.html` → 200, contains "BAM Technologies").
- **Other copies found:** `Retail_Version/index.html` + `style.css` (gitignored, local only, not deployed). `portfolio.html` (deployed, not linked from `index.html`, old project list; title "George Wallden - Portfolio"). Neither is the content source.
- **Print path:** `css/print.css` (linked `media="print"` at `index.html:11`) hides `.contact-screen`, shows `.contact-print`, appends `(href)` after links. No PDF exists anywhere.

## 3. What a no-JS fetch sees today (2026-09-09, curl -sL)

| URL | HTTP | Bytes | Contains resume text? |
|---|---|---|---|
| `https://www.georgewallden.com/` | 200 (X-Cache: Hit from cloudfront) | 1356 | **No** — placeholder shell only |
| `https://georgewallden.com/` | 200 | 1356 | No (same shell) |
| `https://www.georgewallden.com/portfolio.html` | 200 | 6826 | Old portfolio only; 0 resume strings except "Terraform" |
| `https://www.georgewallden.com/components/experience.html` | 200 | 3168 | Yes (fragment) |
| `https://www.georgewallden.com/robots.txt` | **403** AccessDenied | 111 | file does not exist |
| `https://www.georgewallden.com/sitemap.xml` | **403** AccessDenied | 111 | file does not exist |
| `https://www.georgewallden.com/resume`, `/resume/` | **403** | — | no such key; S3-via-OAC returns 403 for any missing object, and CloudFront has no error mapping |

Grep of the root response (`grep -c`), all **0**: `BAM Technologies`, `Mistras`, `Security+`, `Product Developer II`, `Application Developer`, `The College of New Jersey`, `GEORGE WALLDEN`, `Terraform`, `RAG Architecture`, `PROJECTS`, `georgewallden@outlook.com`.

The only meaningful text in the root response is `<title>George Wallden - AI Application Engineer</title>` (`index.html:7`). Full saved root response:

```html
<!-- index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>George Wallden - AI Application Engineer</title>
    <!-- Title text hardcoded — update here too if job title in components/header.html changes -->

    <link rel="stylesheet" href="css/main.css">
    <link rel="stylesheet" href="css/print.css" media="print">
</head>
<body>

    <div class="container">
        <aside class="sidebar">
            <!-- Sidebar component placeholders -->
            <div id="header-placeholder"></div>
            <div id="contact-info-placeholder"></div>
            <div id="education-placeholder"></div>
            <div id="certifications-placeholder"></div>
            <div id="capabilities-placeholder"></div>
            <div id="core-technologies-placeholder"></div>
        </aside>
        
        <main class="main-content">
            <!-- Main content component placeholders -->
            <!-- <div id="summary-placeholder"></div> -->
            <div id="experience-placeholder"></div>
            <div id="projects-placeholder"></div>
            <div id="technical-skills-placeholder"></div>
        </main>
    </div>

    <!-- The script that will assemble our page -->
    <script src="js/app.js"></script>

</body>
</html>
```

## 4. robots / sitemap / meta / Search Console

- `robots.txt`: absent (403). Google treats a 4xx robots.txt as "no restrictions", so crawling is not blocked, but nothing tells crawlers where the sitemap is.
- `sitemap.xml`: absent (403).
- `<meta>`: only `charset` and `viewport`. No `description`, no OpenGraph/Twitter tags, no canonical, no JSON-LD. `index.html:5-7`.
- Two hostnames both serve 200 (`www` and apex) with no canonical → duplicate-content ambiguity for indexers.
- Search Console: **not determinable from the repo or AWS.** Open question for George (§7).

## 5. Prerender options assessed

Constraint: no framework, no bundler, no dependencies, deploy = `aws s3 sync .`. The whole "SPA" is one 40-line fetch-and-inject script.

| Option | Verdict | Why |
|---|---|---|
| **A. Build-time inline (recommended)** — a ~30-line zero-dependency Node script (`node build.js`) that reads `index.html`, replaces each `<div id="X-placeholder"></div>` with the matching `components/*.html` body, writes `dist/index.html` (plus copies css/js/portfolio), and `deploy.yml` syncs `dist/` instead of `.`. `app.js` stays for unbuilt local preview but skips any placeholder that already has children. | **Recommend** | Single content source preserved (`components/*.html` remain the only place text lives); no dependencies; runs in the existing Action in under 1s; resume route stays `/` so no CloudFront changes; keeps the repo editable as today. |
| B. `react-snap` / puppeteer-style prerender | Reject | Pulls headless Chromium into CI to render a page that is literally string concatenation. Adds a dependency tree and about a minute of CI time for zero benefit over A. |
| C. `vite-ssg` / `vite-plugin-prerender` | Reject | Requires adopting Vite first; there is no Vite project. |
| D. Hand-maintained static `resume.html` copy | Reject | Second copy of the text; drifts from `components/` and violates the module one-source rule. |
| E. SSR framework migration (Next/Astro) | Reject | Nothing to migrate; Cut line in Implementation Order says escalate. Not needed, prerendering is trivially practical here. |

**Cut-line verdict: prerendering is practical. Proceed to v0.0.2.**

## 6. Structural defects noticed (for v0.0.2, markup-only)

- `components/experience.html:17` and `:30` — `<div class="experience-gap">` opened, never closed (2x). Browsers auto-repair; strict parsers may nest the second job inside the first.
- `components/contact-info.html:17-23` — `<div>` elements as direct children of `<ul>` (invalid). `<li>` inside `<div>` inside `<ul>`.
- `components/header.html:4-5` — job title split across two `<p>` elements ("AI Application " / "Engineer"); text-extractors see two lines. Merging into one element is markup-only, text unchanged.
- `index.html:28` summary placeholder is commented out while `app.js:32` still fetches `summary.html` → harmless console warning; also means the Summary section is not on the live page.
- Heading inventory vs. module directive (Summary / Experience / Skills / Projects / Education / Certifications): current headings are `CONTACT INFO:`, `EDUCATION`, `CERTIFICATIONS`, `Capabilities`, `LANGUAGES & APIs`, `Infrastructure & DevOps`, `EXPERIENCE`, `PROJECTS`, `Technical Skills`. Renaming/merging headings changes visible text — George decides, see §7.
- Missing pages 403 instead of 404 (S3 OAC behavior, no CloudFront custom error response). Cosmetic for users; slightly worse for crawlers. Fix would be a CloudFront `CustomErrorResponses` entry 403→404 — infra change, flag for v0.0.3.
- Once `docs/` exists in the repo it will be synced to the public bucket by `deploy.yml` unless excluded. v0.0.2 should add `--exclude "docs/*"` (or move to `dist/` sync, which solves it implicitly).

## 7. Open questions for George

1. Is Google Search Console set up for `georgewallden.com` (either property type)? Needed for v0.0.3 step 6 / v0.0.5 step 4.
2. Heading names: OK to leave `Capabilities`, `LANGUAGES & APIs`, `Infrastructure & DevOps`, `CONTACT INFO:` as-is for M00 (structure only), and treat any rename as M02 content work? Recommendation: yes, leave.
3. Canonical host: `www.georgewallden.com` (matches bucket name and existing title/links) — confirm as the canonical for v0.0.3.
4. `portfolio.html` — keep deploying as-is, or exclude from sitemap? Recommendation: leave deployed, omit from sitemap (stale, unlinked).
5. Should the resume live at `/` only, or also at `/resume/`? Recommendation: `/` only for M00; a `/resume/` alias needs a CloudFront Function or a `resume/index.html` copy (second copy → no).

## 8. Out-of-scope discoveries (not M00)

- `ResumeVisitorNotifier` Lambda@Edge: `deploy.yml` updates and publishes it on every push, but the CloudFront default cache behavior has `LambdaFunctionAssociations.Quantity = 0` and no other behavior references it. The notifier is not attached to the distribution and cannot fire. Distribution last modified 2026-08-25. Parked — infra, not rendering.
