"""Redraw graphify-out/graph.html as the family tree (owner, 2026-10-07: "I want it to represent my family as the root
tree"). The graph's 100-odd automatic communities become one group per family member, chosen by where a node comes
from (its folder, or the member a script or note works for). A root node, "The family", links to one hub per member,
and each hub links to that member's files, so the layout reads root -> member -> files -> code.

Run after every /graphify build (it overwrites graph.html; the automatic-community view is kept as
graph-communities.html):  python3 scripts/family_graph.py
"""
from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "graphify-out"

# Group order is the legend order. Each: (name, folders, script/file name patterns, label patterns)
GROUPS = [
    ("The family (shared)", ["common-data", "plan.md", "README.md"], [], [r"\bfamily\b", r"owner'?s fence", r"\bsteers?\b"]),
    ("The CEO (ceoA)", ["the-ceo"], [r"seed_ceo_page_state", r"daily-check"], [r"\bthe ceo\b", r"\bceoa\b"]),
    ("Lead Gen (leaA)", ["lead-gen", "common-data/testset"],
     [r"candidates-feed", r"enrich_leads", r"propose_lead_facts", r"testset_"], [r"\blead gen\b", r"\bleaa\b", r"\blead rule\b"]),
    ("Package Designer (pacA)", ["package-designer"],
     [r"enrich_packages", r"publish_ny_packages", r"refresh_packages_page", r"sync_packages_page", r"sync_what_we_have"],
     [r"\bpackage designer\b", r"\bpaca\b", r"\brate desk\b"]),
    ("Scout (scoA)", ["scout"], [r"search_check", r"provider_watch", r"check-keys"], [r"\bscout\b", r"\bscoa\b"]),
    ("Validator (valB)", ["validator"], [], [r"\bvalidator\b", r"\bvalb\b"]),
    ("Research Analyst (anaA)", ["research-analyst"], [], [r"\bresearch analyst\b", r"\banaa\b"]),
    ("Owner's dashboard (webapp)", ["webapp"], [r"start-data-servers", r"providers-json", r"digest\.py"], []),
    ("Owner's tools", ["scripts", "launchd", ".githooks"], [], []),
]


def group_of(node: dict) -> int:
    src = str(node.get("source_file") or "").replace(str(Path.home() / "bots") + "/", "")
    label = str(node.get("label") or "").lower()
    name = src.rsplit("/", 1)[-1]
    for i, (_, _, files, _) in enumerate(GROUPS):  # a script that works for one member belongs to it
        if any(re.search(p, name) for p in files):
            return i
    # a shared note about one member (e.g. "Lead Gen (leaA)" in family.md) sits with that member
    if src.startswith("common-data") or src in ("plan.md", ""):
        for i, (_, _, _, labels) in enumerate(GROUPS[1:], start=1):
            if any(re.search(p, label) for p in labels):
                return i
    best, best_len = len(GROUPS) - 1, -1
    for i, (_, folders, _, _) in enumerate(GROUPS):
        for f in folders:
            if (src == f or src.startswith(f + "/")) and len(f) > best_len:
                best, best_len = i, len(f)
    return best


def main() -> int:
    py = (OUT / ".graphify_python").read_text().strip() if (OUT / ".graphify_python").exists() else sys.executable
    if Path(sys.executable).resolve() != Path(py).resolve():  # graphify lives in its own interpreter
        import subprocess
        return subprocess.call([py, __file__, *sys.argv[1:]])
    import networkx as nx
    from graphify.export import to_html

    data = json.loads((OUT / "graph.json").read_text())
    G = nx.Graph()
    for n in data["nodes"]:
        G.add_node(n["id"], **{k: v for k, v in n.items() if k != "id"})
    for e in data["links"]:
        G.add_edge(e["source"], e["target"], **{k: v for k, v in e.items() if k not in ("source", "target")})

    communities: dict[int, list[str]] = {i: [] for i in range(len(GROUPS))}
    for nid, attrs in list(G.nodes(data=True)):
        communities[group_of(attrs)].append(nid)

    root = "zz_family_tree_root"
    G.add_node(root, label="The family", file_type="concept", source_file="", community=0)
    communities[0].append(root)
    for i, (name, *_rest) in enumerate(GROUPS):
        hub = f"family_hub_{i}"
        if i:
            G.add_node(hub, label=name, file_type="concept", source_file="", community=i)
            communities[i].append(hub)
            G.add_edge(root, hub, relation="family member", confidence="EXTRACTED", confidence_score=1.0, weight=3.0)
        else:
            hub = root
        # the member's files (a node labelled with its own file name) hang off its hub
        for nid in communities[i]:
            a = G.nodes[nid]
            src = str(a.get("source_file") or "")
            if nid not in (root, hub) and src and str(a.get("label", "")) == src.rsplit("/", 1)[-1]:
                G.add_edge(hub, nid, relation="belongs to", confidence="EXTRACTED", confidence_score=1.0, weight=2.0)

    for i, ids in communities.items():
        for nid in ids:
            G.nodes[nid]["community"] = i
            G.nodes[nid]["community_name"] = GROUPS[i][0]
    labels = {i: g[0] for i, g in enumerate(GROUPS)}
    html = OUT / "graph.html"
    keep = OUT / "graph-communities.html"
    if html.exists() and "zz_family_tree_root" not in html.read_text(errors="ignore"):
        shutil.copy(html, keep)  # graphify's own view, before the first redraw after a build
    to_html(G, {i: v for i, v in communities.items() if v}, str(html), community_labels=labels)
    for i, ids in communities.items():
        print(f"{len(ids):5}  {labels[i]}")
    print(f"wrote {html} ({G.number_of_nodes()} nodes, {len(GROUPS)} groups); graphify's view kept in {keep.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
