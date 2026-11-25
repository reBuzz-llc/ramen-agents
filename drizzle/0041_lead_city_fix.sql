-- Rows whose city column holds a street ("276 Fifth Avenue", "3009 Ocean Parkway", "36-18 Main St",
-- "1001 Irving Ave #7": an older placeOf took a full address's first part as the city). Only a city that starts
-- with a house number is touched; it is worked out again from the location as lib/lead-filters.ts placeOf does now: the
-- place-like part nearest before the last part that reads as a state, else the first place-like part, else nothing.
-- "Bay Terrace" and "St. Albans" (no number) stay. Each change is in the row's history (lead_cells, reason "derived") and
-- moves its rev, so the bots' readers pick it up. Runs once, with the deploy.
WITH parts AS (
  SELECT l.id, p.ord, btrim(p.part) AS part,
         lower(btrim(regexp_replace(btrim(p.part), '\s*\d{5}(-\d{4})?$', ''))) AS word
  FROM leads l
  CROSS JOIN LATERAL unnest(string_to_array(coalesce(l.location, ''), ',')) WITH ORDINALITY AS p(part, ord)
  WHERE l.city ~ '^\s*\d'
),
marked AS (
  SELECT id, ord, part, word,
         (part ~ '^\d'
          OR (part ~ '\d' AND part ~* '\m(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|hwy|highway|pkwy|parkway|pl|place|ct|court|way|ter|terrace|sq|square)\.?$')
          OR part ~* '^(suite|ste|unit|apt|floor|fl)\M'
          OR part ~ '#\s*\d'
          OR part = '') AS street,
         (ord > 1 AND (word IN ('new york', 'n.y.', 'ny', 'california', 'florida', 'michigan', 'new jersey', 'texas', 'united kingdom', 'england')
                       OR (word ~ '^[a-z]{2}$' AND word <> 'us'))) AS is_state
  FROM parts
),
last_state AS (
  SELECT id, max(ord) AS sord FROM marked WHERE is_state GROUP BY id
),
before_state AS (
  SELECT DISTINCT ON (m.id) m.id, m.part
  FROM marked m JOIN last_state s ON s.id = m.id
  WHERE m.ord < s.sord AND NOT m.street
  ORDER BY m.id, m.ord DESC
),
first_place AS (
  SELECT DISTINCT ON (m.id) m.id, m.part
  FROM marked m
  WHERE NOT m.street AND m.id NOT IN (SELECT id FROM last_state)
  ORDER BY m.id, m.ord
),
target AS (
  SELECT l.id, l.tenant_id, l.city AS old_city, NULLIF(coalesce(b.part, f.part, ''), '') AS new_city
  FROM leads l
  LEFT JOIN before_state b ON b.id = l.id
  LEFT JOIN first_place f ON f.id = l.id
  WHERE l.city ~ '^\s*\d'
),
upd AS (
  UPDATE leads SET city = t.new_city, updated_at = now(), rev = nextval('leads_rev_seq')
  FROM target t WHERE leads.id = t.id
  RETURNING leads.id
)
INSERT INTO lead_cells (tenant_id, lead_id, "column", old, new, actor_kind, actor_name, reason)
SELECT t.tenant_id, t.id, 'city', to_jsonb(t.old_city), to_jsonb(t.new_city), 'bot', 'Peek (city worked out from location again)', 'derived'
FROM target t JOIN upd ON upd.id = t.id;
