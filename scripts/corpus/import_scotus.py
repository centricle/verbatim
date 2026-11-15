#!/usr/bin/env python3
"""Import landmark Supreme Court opinions into the verbatim corpus.

Sources:
- WikiSource: Well-transcribed landmark opinions with clean wikitext
- Cornell LII (law.cornell.edu): Full opinion text for cases not on WikiSource

All Supreme Court opinions are public domain US government works.
Curated set of ~50-100 landmark cases (majority opinions + key dissents).
"""

import os
import re
import sys
import time

import requests
from bs4 import BeautifulSoup

from ingest import bulk_insert, make_id, user_agent, RAW_DIR

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": user_agent()
})

TMP_DIR = RAW_DIR


def read_local_or_fetch(filename, url):
    """Read from local tmp/ cache, or fetch from URL if not cached."""
    local_path = os.path.join(TMP_DIR, filename)
    if os.path.exists(local_path):
        print(f"  Reading from local cache: tmp/{filename}")
        with open(local_path, encoding="utf-8", errors="replace") as f:
            return f.read()
    print(f"  Fetching from {url}...")
    resp = SESSION.get(url, timeout=60)
    resp.raise_for_status()
    os.makedirs(TMP_DIR, exist_ok=True)
    with open(local_path, "w", encoding="utf-8") as f:
        f.write(resp.text)
    return resp.text


def strip_wikitext(raw):
    """Convert WikiSource wikitext to plain text."""
    text = re.sub(r'\{\{header[^}]*\}\}', '', raw, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r'\{\{[^}]*\}\}', '', text)
    text = re.sub(r'\[\[Category:[^\]]*\]\]', '', text)
    text = re.sub(r'\[\[[a-z]{2,3}:[^\]]*\]\]', '', text)
    text = re.sub(r'\[\[[^\]]*\|([^\]]*)\]\]', r'\1', text)
    text = re.sub(r'\[\[([^\]]*)\]\]', r'\1', text)
    text = re.sub(r"'{2,}", '', text)
    text = re.sub(r'<ref[^>]*>.*?</ref>', '', text, flags=re.DOTALL)
    text = re.sub(r'<ref[^/]*/>', '', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'^=+\s*(.*?)\s*=+$', r'\1', text, flags=re.MULTILINE)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def fetch_wikisource_page(page_title):
    """Fetch and parse a WikiSource page via the API."""
    url = "https://en.wikisource.org/w/api.php"
    params = {
        "action": "parse",
        "page": page_title,
        "prop": "wikitext",
        "format": "json",
    }
    try:
        resp = SESSION.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            return None
        wikitext = data.get("parse", {}).get("wikitext", {}).get("*", "")
        cleaned = strip_wikitext(wikitext)
        return cleaned if len(cleaned) > 200 else None
    except Exception as e:
        print(f"  ERROR fetching {page_title}: {e}")
        return None


def extract_cornell_opinion(html):
    """Extract opinion text from a Cornell LII Supreme Court page."""
    soup = BeautifulSoup(html, "html.parser")
    # Cornell wraps opinion text in various containers
    content = soup.select_one("#opinion") or soup.select_one(".field-name-body")
    if not content:
        # Try getting all paragraph text
        content = soup.select_one("article") or soup.select_one("main")
    if not content:
        return None
    text = content.get_text(separator="\n\n").strip()
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text if len(text) > 500 else None


# Landmark SCOTUS cases — organized by era
# Format: (wikisource_page, speaker_slug, date, case_name, opinion_type)
# opinion_type: "majority", "dissent", "concurrence"
LANDMARK_CASES = [
    # Early Republic & Marshall Court
    ("Marbury_v._Madison/Opinion_of_the_Court",
     "john-marshall", "1803-02-24",
     "Marbury v. Madison (5 U.S. 137)", "majority"),

    ("McCulloch_v._Maryland/Opinion_of_the_Court",
     "john-marshall", "1819-03-06",
     "McCulloch v. Maryland (17 U.S. 316)", "majority"),

    ("Gibbons_v._Ogden",
     "john-marshall", "1824-03-02",
     "Gibbons v. Ogden (22 U.S. 1)", "majority"),

    # Pre-Civil War
    ("Dred_Scott_v._Sandford/Opinion_of_the_Court",
     "roger-taney", "1857-03-06",
     "Dred Scott v. Sandford (60 U.S. 393)", "majority"),

    ("Dred_Scott_v._Sandford/Dissent_Curtis",
     "john-marshall", "1857-03-06",
     "Dred Scott v. Sandford — Curtis Dissent (60 U.S. 393)", "dissent"),

    # Reconstruction & Gilded Age
    ("Plessy_v._Ferguson/Opinion_of_the_Court",
     "john-marshall", "1896-05-18",
     "Plessy v. Ferguson (163 U.S. 537)", "majority"),

    ("Plessy_v._Ferguson/Dissent",
     "john-harlan", "1896-05-18",
     "Plessy v. Ferguson — Harlan Dissent (163 U.S. 537)", "dissent"),

    # Progressive Era
    ("Lochner_v._New_York/Opinion_of_the_Court",
     "john-marshall", "1905-04-17",
     "Lochner v. New York (198 U.S. 45)", "majority"),

    ("Lochner_v._New_York/Dissent_Holmes",
     "oliver-wendell-holmes", "1905-04-17",
     "Lochner v. New York — Holmes Dissent (198 U.S. 45)", "dissent"),

    ("Schenck_v._United_States",
     "oliver-wendell-holmes", "1919-03-03",
     "Schenck v. United States (249 U.S. 47)", "majority"),

    ("Abrams_v._United_States/Dissent",
     "oliver-wendell-holmes", "1919-11-10",
     "Abrams v. United States — Holmes Dissent (250 U.S. 616)", "dissent"),

    # New Deal Era
    ("West_Coast_Hotel_Co._v._Parrish",
     "john-marshall", "1937-03-29",
     "West Coast Hotel Co. v. Parrish (300 U.S. 379)", "majority"),

    ("Korematsu_v._United_States/Opinion_of_the_Court",
     "hugo-black", "1944-12-18",
     "Korematsu v. United States (323 U.S. 214)", "majority"),

    ("Korematsu_v._United_States/Dissent_Jackson",
     "robert-jackson", "1944-12-18",
     "Korematsu v. United States — Jackson Dissent (323 U.S. 214)", "dissent"),

    # Warren Court
    ("Brown_v._Board_of_Education_of_Topeka/Opinion_of_the_Court",
     "earl-warren", "1954-05-17",
     "Brown v. Board of Education (347 U.S. 483)", "majority"),

    ("Miranda_v._Arizona/Opinion_of_the_Court",
     "earl-warren", "1966-06-13",
     "Miranda v. Arizona (384 U.S. 436)", "majority"),

    ("Gideon_v._Wainwright",
     "hugo-black", "1963-03-18",
     "Gideon v. Wainwright (372 U.S. 335)", "majority"),

    ("Loving_v._Virginia",
     "earl-warren", "1967-06-12",
     "Loving v. Virginia (388 U.S. 1)", "majority"),

    ("Tinker_v._Des_Moines_Independent_Community_School_District",
     "john-marshall", "1969-02-24",
     "Tinker v. Des Moines (393 U.S. 503)", "majority"),

    # Burger Court
    ("Roe_v._Wade/Opinion_of_the_Court",
     "harry-blackmun", "1973-01-22",
     "Roe v. Wade (410 U.S. 113)", "majority"),

    ("Roe_v._Wade/Dissent_Rehnquist",
     "william-rehnquist", "1973-01-22",
     "Roe v. Wade — Rehnquist Dissent (410 U.S. 113)", "dissent"),

    ("New_York_Times_Co._v._United_States",
     "hugo-black", "1971-06-30",
     "New York Times Co. v. United States (403 U.S. 713)", "majority"),

    ("United_States_v._Nixon/Opinion_of_the_Court",
     "john-marshall", "1974-07-24",
     "United States v. Nixon (418 U.S. 683)", "majority"),

    ("Regents_of_the_Univ._of_Cal._v._Bakke",
     "john-marshall", "1978-06-28",
     "Regents of the University of California v. Bakke (438 U.S. 265)", "majority"),

    # Rehnquist Court
    ("Texas_v._Johnson/Opinion_of_the_Court",
     "william-brennan", "1989-06-21",
     "Texas v. Johnson (491 U.S. 397)", "majority"),

    ("Planned_Parenthood_v._Casey/Opinion_of_the_Court",
     "sandra-day-oconnor", "1992-06-29",
     "Planned Parenthood v. Casey (505 U.S. 833)", "majority"),

    ("Bush_v._Gore/Opinion_of_the_Court",
     "john-marshall", "2000-12-12",
     "Bush v. Gore (531 U.S. 98)", "majority"),

    ("Bush_v._Gore/Dissent_Stevens",
     "john-paul-stevens", "2000-12-12",
     "Bush v. Gore — Stevens Dissent (531 U.S. 98)", "dissent"),

    # Roberts Court
    ("District_of_Columbia_v._Heller/Opinion_of_the_Court",
     "antonin-scalia", "2008-06-26",
     "District of Columbia v. Heller (554 U.S. 570)", "majority"),

    ("District_of_Columbia_v._Heller/Dissent_Stevens",
     "john-paul-stevens", "2008-06-26",
     "District of Columbia v. Heller — Stevens Dissent (554 U.S. 570)", "dissent"),

    ("Citizens_United_v._Federal_Election_Commission/Opinion_of_the_Court",
     "anthony-kennedy", "2010-01-21",
     "Citizens United v. FEC (558 U.S. 310)", "majority"),

    ("Citizens_United_v._Federal_Election_Commission/Dissent_Stevens",
     "john-paul-stevens", "2010-01-21",
     "Citizens United v. FEC — Stevens Dissent (558 U.S. 310)", "dissent"),

    ("National_Federation_of_Independent_Business_v._Sebelius/Opinion_of_Roberts",
     "john-roberts", "2012-06-28",
     "NFIB v. Sebelius — Roberts Opinion (567 U.S. 519)", "majority"),

    ("Obergefell_v._Hodges/Opinion_of_the_Court",
     "anthony-kennedy", "2015-06-26",
     "Obergefell v. Hodges (576 U.S. 644)", "majority"),

    ("Obergefell_v._Hodges/Dissent_Scalia",
     "antonin-scalia", "2015-06-26",
     "Obergefell v. Hodges — Scalia Dissent (576 U.S. 644)", "dissent"),

    ("Dobbs_v._Jackson_Women%27s_Health_Organization/Opinion_of_the_Court",
     "samuel-alito", "2022-06-24",
     "Dobbs v. Jackson Women\u2019s Health Organization (597 U.S. 215)", "majority"),

    ("Dobbs_v._Jackson_Women%27s_Health_Organization/Dissent",
     "sonia-sotomayor", "2022-06-24",
     "Dobbs v. Jackson — Joint Dissent (597 U.S. 215)", "dissent"),
]

# Additional landmark cases available on WikiSource as single pages (not subpages)
SINGLE_PAGE_CASES = [
    ("Mapp_v._Ohio", "earl-warren", "1961-06-19",
     "Mapp v. Ohio (367 U.S. 643)", "majority"),
    ("Engel_v._Vitale", "hugo-black", "1962-06-25",
     "Engel v. Vitale (370 U.S. 421)", "majority"),
    ("Heart_of_Atlanta_Motel,_Inc._v._United_States",
     "john-marshall", "1964-12-14",
     "Heart of Atlanta Motel v. United States (379 U.S. 241)", "majority"),
    ("Brandenburg_v._Ohio", "john-marshall", "1969-06-09",
     "Brandenburg v. Ohio (395 U.S. 444)", "majority"),
    ("Furman_v._Georgia", "john-marshall", "1972-06-29",
     "Furman v. Georgia (408 U.S. 238)", "majority"),
    ("Gregg_v._Georgia", "potter-stewart", "1976-07-02",
     "Gregg v. Georgia (428 U.S. 153)", "majority"),
]


def import_landmark_opinions():
    """Import landmark SCOTUS opinions from WikiSource."""
    print("Importing landmark Supreme Court opinions from WikiSource...")
    records = []
    errors = []

    all_cases = LANDMARK_CASES + SINGLE_PAGE_CASES

    for entry in all_cases:
        if len(entry) == 5:
            page_title, speaker, date, case_name, opinion_type = entry
        else:
            continue

        time.sleep(0.5)
        label = f"{case_name}"
        if opinion_type != "majority":
            label += f" [{opinion_type}]"
        print(f"  Fetching: {label}...", end=" ", flush=True)

        text = fetch_wikisource_page(page_title)
        if not text or len(text) < 200:
            print("SKIP (empty or too short)")
            errors.append(page_title)
            continue

        title = case_name
        if opinion_type == "dissent":
            title += " (Dissent)"
        elif opinion_type == "concurrence":
            title += " (Concurrence)"

        source_url = f"https://en.wikisource.org/wiki/{page_title}"
        records.append({
            "id": make_id(speaker, text),
            "speaker": speaker,
            "date": date,
            "type": "opinion",
            "source_url": source_url,
            "source_name": "wikisource",
            "text": text,
            "title": title,
        })
        print(f"OK ({len(text)} chars)")

    if records:
        inserted = bulk_insert(records)
        print(f"\nSCOTUS opinions: {len(records)} fetched, {inserted} processed")

    if errors:
        print(f"\nSkipped ({len(errors)}): {', '.join(errors[:10])}")
        if len(errors) > 10:
            print(f"  ... and {len(errors) - 10} more")

    return records


def import_cornell_opinions():
    """Import additional opinions from Cornell LII where WikiSource lacks them.

    Only used as a fallback for cases not found on WikiSource.
    """
    # Cornell citations: (volume, page, speaker, date, case_name, opinion_type, cache_key)
    cornell_cases = [
        ("388", "1", "earl-warren", "1967-06-12",
         "Loving v. Virginia (388 U.S. 1)", "majority", "loving_v_virginia"),
    ]

    print("\nImporting SCOTUS opinions from Cornell LII (fallback)...")
    records = []

    for vol, page, speaker, date, case_name, opinion_type, cache_key in cornell_cases:
        url = f"https://www.law.cornell.edu/supremecourt/text/{vol}/{page}"
        cache_file = f"scotus_cornell_{cache_key}.html"
        print(f"  Fetching: {case_name}...", end=" ", flush=True)

        try:
            html = read_local_or_fetch(cache_file, url)
            text = extract_cornell_opinion(html)

            if not text:
                print("SKIP (could not extract opinion)")
                continue

            title = case_name
            if opinion_type == "dissent":
                title += " (Dissent)"

            records.append({
                "id": make_id(speaker, text),
                "speaker": speaker,
                "date": date,
                "type": "opinion",
                "source_url": url,
                "source_name": "cornell_lii",
                "text": text,
                "title": title,
            })
            print(f"OK ({len(text)} chars)")
        except Exception as e:
            print(f"ERROR: {e}")

        time.sleep(1)

    if records:
        inserted = bulk_insert(records)
        print(f"  Cornell opinions: {len(records)} fetched, {inserted} processed")
    return records


def main():
    total = 0

    ws = import_landmark_opinions()
    total += len(ws)

    cornell = import_cornell_opinions()
    total += len(cornell)

    print(f"\n{'='*60}")
    print(f"Total SCOTUS records imported: {total}")


if __name__ == "__main__":
    main()
