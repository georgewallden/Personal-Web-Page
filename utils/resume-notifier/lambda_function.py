"""
Lambda@Edge viewer-request handler for georgewallden.com

Fires on EVERY request (unlike origin-request, which only fires on cache miss).
Sends an SES notification for real human pageviews, filtering out bots and
static asset requests.

CRITICAL: this runs on the critical path of every page load. Every code path
must return the `request` object, and the SES call must never be allowed to
throw. A failure here takes the site down.

Runtime: python3.13
Role:    arn:aws:iam::429557936440:role/LambdaEdgeSESNotifierRole
Limits:  viewer-request = 5s timeout, 1MB package, 128MB memory, no env vars
"""

import hashlib
from datetime import datetime, timezone

import boto3

SENDER = "notifier@georgewallden.com"
RECIPIENT = "georgewallden@outlook.com"
REGION = "us-east-1"

# Lambda@Edge has no env vars, so config lives here as constants.

BOT_PATTERNS = [
    "bot", "crawler", "spider", "slurp", "curl", "wget", "python-requests",
    "headlesschrome", "phantomjs", "scrapy", "facebookexternalhit",
    "googlebot", "bingbot", "ahrefsbot", "semrushbot", "dotbot",
    "mj12bot", "petalbot", "applebot", "yandexbot", "duckduckbot",
    "linkedinbot", "twitterbot", "discordbot", "slackbot", "whatsapp",
    "uptimerobot", "pingdom", "datadog", "lighthouse", "gtmetrix",
    "chrome-lighthouse", "google-inspectiontool", "bytespider",
]

# Don't notify on every css/js/image fetch — one page view can be 30 requests.
IGNORED_EXT = (
    ".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
    ".woff", ".woff2", ".ttf", ".eot", ".map", ".webp", ".json", ".txt",
    ".xml", ".pdf", ".mp4", ".webm",
)

REFERER_SOURCES = {
    "linkedin": "LinkedIn",
    "google": "Google Search",
    "bing": "Bing",
    "duckduckgo": "DuckDuckGo",
    "github": "GitHub",
    "reddit": "Reddit",
    "twitter": "Twitter/X",
    "x.com": "Twitter/X",
    "facebook": "Facebook",
    "indeed": "Indeed",
    "glassdoor": "Glassdoor",
    "ziprecruiter": "ZipRecruiter",
    "dice.com": "Dice",
    "news.ycombinator": "Hacker News",
    "stackoverflow": "Stack Overflow",
}


def header(headers, name, default=""):
    """CloudFront header values arrive as [{'key':..., 'value':...}]."""
    entry = headers.get(name)
    if entry and len(entry) > 0:
        return entry[0].get("value", default)
    return default


def is_bot(user_agent):
    if not user_agent:
        return True  # no UA at all is almost always automated
    ua = user_agent.lower()
    return any(p in ua for p in BOT_PATTERNS)


def parse_ua(ua):
    """Crude device/browser guess. Good enough for a notification email."""
    u = ua.lower()

    if "iphone" in u:
        device = "iPhone"
    elif "ipad" in u:
        device = "iPad"
    elif "android" in u:
        device = "Android"
    elif "macintosh" in u or "mac os" in u:
        device = "Mac"
    elif "windows" in u:
        device = "Windows"
    elif "linux" in u:
        device = "Linux"
    else:
        device = "Unknown"

    # Order matters: Edge and Chrome both contain "chrome" / "safari"
    if "edg/" in u:
        browser = "Edge"
    elif "opr/" in u or "opera" in u:
        browser = "Opera"
    elif "chrome" in u and "chromium" not in u:
        browser = "Chrome"
    elif "firefox" in u:
        browser = "Firefox"
    elif "safari" in u:
        browser = "Safari"
    else:
        browser = "Other"

    return device, browser


def classify_referer(ref):
    if not ref:
        return "Direct / bookmark"
    r = ref.lower()
    for key, label in REFERER_SOURCES.items():
        if key in r:
            return label
    if "georgewallden.com" in r:
        return "Internal"
    return ref[:120]


def lambda_handler(event, context):
    # Wrap the whole body — nothing in here is worth breaking the site over.
    try:
        request = event["Records"][0]["cf"]["request"]
    except (KeyError, IndexError, TypeError):
        # Malformed event; there's nothing safe to return but the original.
        return event.get("Records", [{}])[0].get("cf", {}).get("request", {})

    try:
        _notify(request)
    except Exception as e:  # noqa: BLE001 - deliberate catch-all
        print(f"notifier error (non-fatal): {e}")

    return request


def _notify(request):
    headers = request.get("headers", {})
    uri = request.get("uri", "/")

    if uri.lower().endswith(IGNORED_EXT):
        return

    user_agent = header(headers, "user-agent")
    if is_bot(user_agent):
        return

    ip = request.get("clientIp", "")
    referer = header(headers, "referer")
    country = header(headers, "cloudfront-viewer-country")
    city = header(headers, "cloudfront-viewer-city")
    region_name = header(headers, "cloudfront-viewer-country-region-name")
    tz = header(headers, "cloudfront-viewer-time-zone")
    querystring = request.get("querystring", "")

    device, browser = parse_ua(user_agent)
    source = classify_referer(referer)

    # Stable-ish per-visitor ID: same person across pages in a session,
    # changes if they switch networks. Not a tracking identifier.
    fingerprint = hashlib.sha256(f"{ip}|{user_agent}".encode()).hexdigest()[:8]

    location_parts = [p for p in (city, region_name, country) if p]
    location = ", ".join(location_parts) if location_parts else "Unknown location"

    subject = f"{location} -> {uri} (via {source})"

    body = f"""Visitor #{fingerprint}

Page:      {uri}{'?' + querystring if querystring else ''}
Source:    {source}
Location:  {location}
Timezone:  {tz or 'Unknown'}
Device:    {device} / {browser}
Time:      {datetime.now(timezone.utc).isoformat()}

Raw UA:    {user_agent}
Referer:   {referer or '(none)'}
"""

    ses = boto3.client("ses", region_name=REGION)
    ses.send_email(
        Source=SENDER,
        Destination={"ToAddresses": [RECIPIENT]},
        Message={
            "Subject": {"Data": subject},
            "Body": {"Text": {"Data": body}},
        },
    )