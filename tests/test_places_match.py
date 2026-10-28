"""find_place by name or by website domain, chains excluded (creatorCC queue 2b, 2026-10-28)."""
import sqlite3
from pathlib import Path

import pytest

from explorer.places import find_place, is_chain, _norm


@pytest.fixture
def db(tmp_path: Path) -> Path:
    path = tmp_path / "places.sqlite"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE places (id, name, name_norm, category, website, phone, socials, address, locality, postcode, confidence, status, lat, lon, region)")
    rows = [
        ("Pylos", "https://pylosrestaurant.com", "128 E 7th St", "New York", 0.95, 40.72, -73.98, "NY"),
        ("Mokbar Brooklyn", "https://www.mokbar.com/", "212 Flatbush Ave", "Brooklyn", 0.9, 40.68, -73.97, "NY"),
        ("itsu", "https://www.itsu.com/", "1 Broadway", "New York", 0.9, 40.70, -74.01, "NY"),
        ("BurgerFi", "https://burgerfi.com/locations/ny/queens/", "3 Main St", "Queens", 0.9, 40.75, -73.83, "NY"),
        ("Corner Deli", "https://cornerdeli.com", "5 A St", "Bronx", 0.9, 40.85, -73.88, "NY"),
        ("Corner Deli Two", "https://cornerdeli.com/", "6 B St", "Bronx", 0.9, 40.86, -73.88, "NY"),
        ("Low Pin", "https://lowpin.com", "7 C St", "Queens", 0.5, 40.7, -73.8, "NY"),
        ("Other Name Co", "https://renamed.com", "8 D St", "Queens", 0.9, 40.7, -73.8, "NY"),
    ]
    con.executemany("INSERT INTO places (name, name_norm, website, address, locality, confidence, lat, lon, region) VALUES (?,?,?,?,?,?,?,?,?)",
                    [(n, _norm(n), w, a, l, c, la, lo, r) for n, w, a, l, c, la, lo, r in rows])
    con.commit()
    con.close()
    return path


def test_a_single_store_is_matched_by_name_or_by_domain(db):
    assert find_place("Pylos", "New York, NY", db, "https://pylosrestaurant.com/")["address"] == "128 E 7th St"
    # a different name on the board, one place on the same domain sharing a word
    assert find_place("Mokbar", "Brooklyn, NY", db, "http://mokbar.com/menu")["locality"] == "Brooklyn"


def test_chains_get_no_link(db):
    assert find_place("itsu", "New York, NY", db, "https://itsu.com", industry="Restaurant / Franchise") is None
    assert find_place("Hot Chicken Takeover", "Columbus, OH", db, "https://hotchickentakeover.com", size="9 locations") is None
    assert is_chain("", "Multiple locations") and is_chain("Franchise development", "") and not is_chain("Bakery", "1 location")
    assert find_place("Corner Deli", "Bronx, NY", db, "https://cornerdeli.com") is None      # two places on the domain


def test_a_store_page_low_confidence_or_unrelated_name_is_rejected(db):
    assert find_place("BurgerFi", "Queens, NY", db, "https://burgerfi.com") is None           # a /locations/ page
    assert find_place("Low Pin", "Queens, NY", db, "https://lowpin.com") is None              # confidence 0.5
    assert find_place("Acme Plumbing", "Queens, NY", db, "https://renamed.com") is None       # domain matches, no shared word
