#!/usr/bin/env python3
"""Scrapers for public speech sources.

NOTE: The Rev.com and UCSB scrapers are included for reference but may violate
those sites' terms of service. The Twitter archive scraper uses a public GitHub
mirror of already-released data. The primary corpus is built from the Miller
Center bulk download, Federal Register API, and Project Gutenberg — all explicitly
public and permissively licensed.
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from ingest import SOURCES_LOG, add_record, make_id

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": USER_AGENT})

SPEAKERS = {
    # Presidents (chronological)
    "george-washington": "George Washington",
    "john-adams": "John Adams",
    "thomas-jefferson": "Thomas Jefferson",
    "james-madison": "James Madison",
    "james-monroe": "James Monroe",
    "john-quincy-adams": "John Quincy Adams",
    "andrew-jackson": "Andrew Jackson",
    "martin-van-buren": "Martin Van Buren",
    "william-henry-harrison": "William Henry Harrison",
    "john-tyler": "John Tyler",
    "james-k-polk": "James K. Polk",
    "zachary-taylor": "Zachary Taylor",
    "millard-fillmore": "Millard Fillmore",
    "franklin-pierce": "Franklin Pierce",
    "james-buchanan": "James Buchanan",
    "abraham-lincoln": "Abraham Lincoln",
    "andrew-johnson": "Andrew Johnson",
    "ulysses-s-grant": "Ulysses S. Grant",
    "rutherford-b-hayes": "Rutherford B. Hayes",
    "james-a-garfield": "James A. Garfield",
    "chester-a-arthur": "Chester A. Arthur",
    "grover-cleveland": "Grover Cleveland",
    "benjamin-harrison": "Benjamin Harrison",
    "william-mckinley": "William McKinley",
    "theodore-roosevelt": "Theodore Roosevelt",
    "william-howard-taft": "William Howard Taft",
    "woodrow-wilson": "Woodrow Wilson",
    "warren-g-harding": "Warren G. Harding",
    "calvin-coolidge": "Calvin Coolidge",
    "herbert-hoover": "Herbert Hoover",
    "franklin-d-roosevelt": "Franklin D. Roosevelt",
    "harry-s-truman": "Harry S. Truman",
    "dwight-d-eisenhower": "Dwight D. Eisenhower",
    "john-f-kennedy": "John F. Kennedy",
    "lyndon-b-johnson": "Lyndon B. Johnson",
    "richard-nixon": "Richard Nixon",
    "gerald-ford": "Gerald Ford",
    "jimmy-carter": "Jimmy Carter",
    "ronald-reagan": "Ronald Reagan",
    "george-h-w-bush": "George H. W. Bush",
    "bill-clinton": "Bill Clinton",
    "george-w-bush": "George W. Bush",
    "barack-obama": "Barack Obama",
    "donald-trump": "Donald Trump",
    "joe-biden": "Joe Biden",
}


def log_scrape(source_name, records_fetched, errors=None):
    log = []
    if os.path.exists(SOURCES_LOG):
        with open(SOURCES_LOG) as f:
            try:
                log = json.load(f)
            except json.JSONDecodeError:
                log = []

    log.append({
        "timestamp": datetime.now().isoformat(),
        "source": source_name,
        "records_fetched": records_fetched,
        "errors": errors or [],
    })

    with open(SOURCES_LOG, "w") as f:
        json.dump(log, f, indent=2)


def fetch_with_retry(url, max_retries=3, delay=2):
    for attempt in range(max_retries):
        try:
            resp = SESSION.get(url, timeout=30)
            if resp.status_code == 429 or resp.status_code >= 500:
                wait = delay * (2 ** attempt)
                print(f"  Rate limited/error ({resp.status_code}), waiting {wait}s...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp
        except requests.RequestException as e:
            if attempt == max_retries - 1:
                raise
            wait = delay * (2 ** attempt)
            print(f"  Request error: {e}, retrying in {wait}s...")
            time.sleep(wait)
    return None


def classify_type(title):
    title_lower = title.lower()
    if "executive order" in title_lower:
        return "executive_order"
    if "proclamation" in title_lower:
        return "proclamation"
    if "interview" in title_lower:
        return "interview"
    if "press conference" in title_lower or "press briefing" in title_lower:
        return "press_conference"
    if "press gaggle" in title_lower or "gaggle" in title_lower:
        return "press_gaggle"
    if "remarks" in title_lower:
        return "remarks"
    if "inaugural" in title_lower:
        return "address"
    if "address" in title_lower:
        return "address"
    if "speech" in title_lower:
        return "speech"
    if "rally" in title_lower:
        return "speech"
    if "debate" in title_lower:
        return "debate"
    if "statement" in title_lower:
        return "statement"
    if "memo" in title_lower or "memorandum" in title_lower:
        return "memo"
    if "letter" in title_lower:
        return "letter"
    if "earnings" in title_lower:
        return "earnings_call"
    return "speech"


def parse_rev_date(date_text):
    """Parse date strings from Rev.com transcript pages."""
    date_text = date_text.strip()
    for fmt in ("%b %d, %Y", "%B %d, %Y", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(date_text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    match = re.search(r"(\w+ \d{1,2},? \d{4})", date_text)
    if match:
        for fmt in ("%b %d, %Y", "%B %d, %Y", "%b %d %Y", "%B %d %Y"):
            try:
                return datetime.strptime(match.group(1), fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue
    return None


def scrape_rev(speaker, dry_run=False):
    """Scrape transcripts from Rev.com for a given speaker."""
    display_name = SPEAKERS.get(speaker, speaker.replace("-", " ").title())
    base_url = "https://www.rev.com"
    search_url = f"{base_url}/blog/transcript-category/{speaker}-transcripts"

    print(f"Scraping Rev.com transcripts for {display_name}...")
    errors = []
    records = []

    page = 1
    transcript_urls = []

    while True:
        url = search_url if page == 1 else f"{search_url}/page/{page}"
        print(f"  Fetching listing page {page}: {url}")

        try:
            resp = fetch_with_retry(url)
        except requests.RequestException as e:
            errors.append(f"Failed to fetch listing page {page}: {e}")
            break

        if resp is None or resp.status_code == 404:
            break

        soup = BeautifulSoup(resp.text, "html.parser")

        links = soup.select("a[href*='/blog/transcripts/']")
        if not links:
            links = soup.select("a[href*='/transcript']")

        page_urls = []
        for link in links:
            href = link.get("href", "")
            if "/transcripts/" in href or "/transcript-" in href:
                full_url = urljoin(base_url, href)
                if full_url not in transcript_urls:
                    page_urls.append(full_url)
                    transcript_urls.append(full_url)

        if not page_urls:
            print(f"  No more transcripts found on page {page}")
            break

        print(f"  Found {len(page_urls)} transcript links on page {page}")
        page += 1
        time.sleep(2)

    print(f"\nFound {len(transcript_urls)} total transcript URLs")

    if dry_run:
        for url in transcript_urls[:20]:
            print(f"  {url}")
        if len(transcript_urls) > 20:
            print(f"  ... and {len(transcript_urls) - 20} more")
        return records

    for i, url in enumerate(transcript_urls):
        print(f"  [{i+1}/{len(transcript_urls)}] Fetching: {url}")

        try:
            resp = fetch_with_retry(url)
        except requests.RequestException as e:
            errors.append(f"Failed to fetch {url}: {e}")
            continue

        if resp is None:
            continue

        soup = BeautifulSoup(resp.text, "html.parser")

        title_el = soup.select_one("h1")
        title = title_el.get_text(strip=True) if title_el else ""

        date_str = None
        time_el = soup.select_one("time")
        if time_el:
            date_str = parse_rev_date(time_el.get("datetime", "") or time_el.get_text())
        if not date_str:
            meta_date = soup.select_one('meta[property="article:published_time"]')
            if meta_date:
                date_str = meta_date.get("content", "")[:10]
        if not date_str:
            date_el = soup.select_one(".fl-post-info-date")
            if date_el:
                date_str = parse_rev_date(date_el.get_text())

        text_parts = []
        transcript_el = soup.select_one(".fl-callout-text") or soup.select_one('[class*="transcript"]') or soup.select_one("article")
        if transcript_el:
            for p in transcript_el.find_all(["p", "div"], recursive=True):
                t = p.get_text(strip=True)
                if t and len(t) > 20 and not t.startswith("Rev ›") and "transcription" not in t.lower():
                    text_parts.append(t)

        if not text_parts:
            main = soup.select_one("main") or soup.select_one("article") or soup
            for p in main.find_all("p"):
                t = p.get_text(strip=True)
                if t and len(t) > 30:
                    text_parts.append(t)

        text = "\n\n".join(text_parts)
        if not text or len(text) < 100:
            errors.append(f"No substantial text found at {url}")
            continue

        record = {
            "id": make_id(speaker, text),
            "speaker": speaker,
            "date": date_str,
            "type": classify_type(title),
            "source_url": url,
            "source_name": "rev.com",
            "text": text,
            "title": title,
        }

        result = add_record(record)
        if result:
            records.append(result)
            print(f"    Added: {title[:60]}... ({date_str}, {result['type']})")

        time.sleep(2)

    log_scrape("rev.com", len(records), errors)
    print(f"\nRev.com: {len(records)} records added, {len(errors)} errors")
    return records


def scrape_twitter_archive(speaker, dry_run=False):
    """Load Trump tweets from publicly accessible GitHub archive mirrors."""
    import io
    import zipfile

    if speaker != "donald-trump":
        print(f"Twitter archive only available for donald-trump, got: {speaker}")
        return []

    print("Checking for Trump Twitter archive data...")
    errors = []
    all_tweets = []

    # Repo has condensed_YYYY.json.zip files for 2009-2018
    years = list(range(2018, 2008, -1))

    github_sources = [
        f"https://raw.githubusercontent.com/bpb27/trump_tweet_data_archive/master/condensed_{y}.json.zip"
        for y in years
    ]

    if dry_run:
        print(f"  Would download {len(github_sources)} zip files (2009-2018):")
        for url in github_sources:
            print(f"    {url}")
        return []

    for url in github_sources:
        label = url.split("/")[-1]
        print(f"  Downloading: {label}")
        try:
            resp = fetch_with_retry(url)
        except requests.RequestException as e:
            errors.append(f"Failed: {url} — {e}")
            print(f"    Failed: {e}")
            continue

        if resp is None:
            continue

        try:
            zf = zipfile.ZipFile(io.BytesIO(resp.content))
            for name in zf.namelist():
                if name.endswith(".json"):
                    tweets = json.loads(zf.read(name))
                    all_tweets.extend(tweets)
                    print(f"    {len(tweets)} tweets from {name}")
        except (zipfile.BadZipFile, json.JSONDecodeError) as e:
            errors.append(f"Bad zip/json from {url}: {e}")
            print(f"    Error: {e}")
            continue

        time.sleep(0.5)

    print(f"\n  Total tweets downloaded: {len(all_tweets)}")
    if not all_tweets:
        log_scrape("twitter_archive", 0, errors)
        return []

    # Build records
    records = []
    for tweet in all_tweets:
        text = tweet.get("text", "").strip()
        if not text:
            continue

        date_str = None
        created = tweet.get("created_at", "") or tweet.get("date", "")
        if created:
            for fmt in ("%a %b %d %H:%M:%S %z %Y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
                try:
                    date_str = datetime.strptime(created[:25].strip(), fmt).strftime("%Y-%m-%d")
                    break
                except ValueError:
                    continue
            if not date_str and len(created) >= 10:
                date_str = created[:10]

        records.append({
            "id": make_id("donald-trump", text),
            "speaker": "donald-trump",
            "date": date_str,
            "type": "tweet",
            "source_url": f"https://twitter.com/realDonaldTrump/status/{tweet.get('id_str', tweet.get('id', ''))}",
            "source_name": "trump_tweet_archive_github",
            "text": text,
            "title": "",
        })

    print(f"  Bulk inserting {len(records)} tweets...")
    from ingest import bulk_insert
    inserted = bulk_insert(records)

    log_scrape("twitter_archive", inserted, errors)
    print(f"\nTwitter archive: {inserted} records processed, {len(errors)} errors")
    return records


def scrape_ucsb(speaker, dry_run=False):
    """Scrape from UCSB Presidency Project. Slow — respects 10s crawl delay."""
    display_name = SPEAKERS.get(speaker, speaker.replace("-", " ").title())
    base_url = "https://www.presidency.ucsb.edu"
    # person2=200301 is the UCSB ID for Trump; other speakers would need different IDs
    search_url = f"{base_url}/advanced-search?field-keywords=&field-keywords2=&field-keywords3=&from%5Bdate%5D=&to%5Bdate%5D=&person2=200301&items_per_page=25"

    print(f"Scraping UCSB Presidency Project for {display_name} (10s delay per request)...")
    print("  WARNING: This source has strict rate limits. Use sparingly.")
    errors = []
    records = []

    if dry_run:
        print(f"  Would search: {search_url}")
        print("  10-second delay between requests per robots.txt")
        return records

    try:
        resp = fetch_with_retry(search_url)
    except requests.RequestException as e:
        errors.append(f"Search failed: {e}")
        log_scrape("presidency.ucsb.edu", 0, errors)
        return records

    if resp is None:
        return records

    soup = BeautifulSoup(resp.text, "html.parser")
    links = soup.select(".views-row a[href*='/documents/']")

    doc_urls = []
    for link in links:
        href = link.get("href", "")
        if href:
            doc_urls.append(urljoin(base_url, href))

    print(f"  Found {len(doc_urls)} document links")

    for i, url in enumerate(doc_urls):
        print(f"  [{i+1}/{len(doc_urls)}] Fetching: {url}")

        try:
            resp = fetch_with_retry(url)
        except requests.RequestException as e:
            errors.append(f"Failed: {url} — {e}")
            continue

        if resp is None:
            continue

        soup = BeautifulSoup(resp.text, "html.parser")

        title_el = soup.select_one("h1")
        title = title_el.get_text(strip=True) if title_el else ""

        date_el = soup.select_one(".date-display-single")
        date_str = None
        if date_el:
            date_str = parse_rev_date(date_el.get_text())

        text_el = soup.select_one(".field-docs-content") or soup.select_one(".field--name-field-docs-content")
        text = text_el.get_text(strip=True) if text_el else ""

        if not text or len(text) < 100:
            continue

        record = {
            "id": make_id(speaker, text),
            "speaker": speaker,
            "date": date_str,
            "type": classify_type(title),
            "source_url": url,
            "source_name": "presidency.ucsb.edu",
            "text": text,
            "title": title,
        }

        result = add_record(record)
        if result:
            records.append(result)
            print(f"    Added: {title[:60]}...")

        time.sleep(10)

    log_scrape("presidency.ucsb.edu", len(records), errors)
    print(f"\nUCSB: {len(records)} records added, {len(errors)} errors")
    return records


SCRAPERS = {
    "rev": scrape_rev,
    "twitter": scrape_twitter_archive,
    "ucsb": scrape_ucsb,
}


def main():
    parser = argparse.ArgumentParser(description="Scrape public speech transcripts")
    parser.add_argument("--source", choices=list(SCRAPERS.keys()), help="Run a specific scraper")
    parser.add_argument("--speaker", default="donald-trump", help="Speaker slug (e.g. donald-trump, barack-obama)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be fetched without fetching")
    args = parser.parse_args()

    if args.source:
        SCRAPERS[args.source](speaker=args.speaker, dry_run=args.dry_run)
    else:
        for name, scraper in SCRAPERS.items():
            print(f"\n{'='*60}")
            print(f"Running scraper: {name}")
            print(f"{'='*60}")
            scraper(speaker=args.speaker, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
