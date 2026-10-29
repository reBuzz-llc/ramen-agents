"""One offer, one name: a package that is an existing one in other words is refused (creatorCC queue 15, 2026-10-29)."""
from __future__ import annotations

from explorer.actions import PublishPackage
from explorer.config import NotionConfig, PolicyConfig, PublishConfig
from explorer.policy import Denylist, Policy, PolicyContext, near_duplicate_package, package_overlap

SUPPORT = ["AI Customer Support Agents for NYC Small Businesses", "SMB AI Customer Support Agent Setup",
           "24/7 AI Customer Support Agents for NYC Small Businesses"]


def test_the_three_customer_support_names_are_one_offer():
    for a in SUPPORT:
        for b in SUPPORT:
            assert package_overlap(a, b) >= 0.6, (a, b)


def test_the_comparison_page_shares_only_ai_with_them():
    # a menu of offers, not a rename: matching it would match every AI offer on the page (reported to creatorCC)
    assert package_overlap("SMB AI Implementation Package Comparison", SUPPORT[0]) < 0.6


def test_genuinely_different_packages_do_not_match():
    assert package_overlap("Gym AI Solutions Package", "SMB Website Care Retainer") == 0.0
    assert package_overlap("Next Office — Dedicated Engineer", "Next Office — Growth Squad") < 0.6


def test_a_new_name_for_an_offer_on_the_page_is_refused_and_its_own_name_is_not():
    page = {SUPPORT[1]: "SMB AI Customer Support Agents for NYC Small Businesses - $299/month",
            "Gym AI Solutions Package": "Gym AI Solutions Package - Personalized for NYC Gyms"}
    assert near_duplicate_package("AI Customer Support Agent Package for Small Businesses", page) == SUPPORT[1]
    assert near_duplicate_package(SUPPORT[1], page) == ""                      # improving it under its exact name
    assert near_duplicate_package("Website Care Retainer", page) == ""
    policy = Policy(PolicyConfig(), PublishConfig(), Denylist(), notion=NotionConfig(enabled=True, package_page_id="pg"))
    ctx = PolicyContext(mode="web", current_page=None, actions_in_episode=0, pages_last_hour=0, open_questions=0, last_visit_by_domain={},
                        page_packages=page)
    v = policy.check(PublishPackage(type="publish_package", name=SUPPORT[0], title="24/7 AI Customer Support", email="e", conclusion=""), ctx)
    assert not v.allowed and v.permanent and f"that is '{SUPPORT[1]}' in other words" in v.reason


def test_package_key_cuts_a_price_or_setup_suffix_but_keeps_a_named_offer():
    from explorer.policy import package_key
    assert package_key("24/7 AI Customer Support Agents for NYC Small Businesses – Setup & Management") == package_key("AI Customer Support Agents for NYC Small Businesses")
    assert package_key("AI-Powered Website Enhancement for Small Businesses – $1,450") == package_key("AI-Powered Website Enhancement for Small Businesses")
    assert package_key("Next Office — Dedicated Engineer") != package_key("Next Office — Growth Squad")
