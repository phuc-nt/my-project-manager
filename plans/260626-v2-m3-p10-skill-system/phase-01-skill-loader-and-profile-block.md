# S1 — Skill loader + 5 bundled SKILL.md + `skills:` profile block

**Status:** pending · **Effort:** ~3h · **Blocks:** S2 · **Blocked by:** none

## Goal

Pure loading, NO injection yet. After S1 the system can READ bundled skills and a
profile's candidate-pool list, but nothing reaches the prompt. The 545 baseline tests
stay green (additive only).

## Context Links

- Pattern to mirror (frozen dataclass + parse): `src/profile/loader.py:40` (`LoadedProfile`),
  `:104`/`:118` (how `reports` is parsed from yaml → tuple).
- `yaml` already imported: `src/profile/loader.py:20`.
- Frontmatter precedent: profiles use plain `yaml.safe_load` on the whole file
  (`loader.py:93`); SKILL.md needs a `---`-delimited frontmatter split first.

## Requirements

1. A `skills/` top-level DATA dir (committed) with 5 `SKILL.md` files, flat
   `skills/<name>.md` (KISS — not dir-per-skill; that is C2/ZIP territory).
2. A `Skill` frozen dataclass: `name, description, applies_to: tuple[str,...], body`.
3. `load_skills(skills_dir) -> list[Skill]`: scan `*.md`, parse `---` frontmatter +
   markdown body, skip malformed files gracefully (log, never raise).
4. `LoadedProfile.skills: tuple[str,...]` parsed from `profile.yaml` `skills:` like
   `reports`. Absent/empty → `()`.
5. `default` profile.yaml gets NO `skills:` block (unchanged behavior).

## Files to Create

- `skills/flag-risk.md`
- `skills/estimate-effort.md`
- `skills/fetch-jira-epics.md`
- `skills/parse-github-labels.md`
- `skills/prioritize-blockers.md`

  Each:
  ```
  ---
  name: flag-risk
  description: Rank and name the single highest-impact risk.
  applies_to: [daily, weekly]
  # allowed-tools: []   # forward-compat only — PARSED-AND-IGNORED this round (C1)
  ---
  Khi tổng hợp rủi ro: xếp hạng blocker > overdue > stale-PR. Nêu RÕ một hạng mục
  ảnh hưởng lớn nhất kèm hành động (ai/cái gì). Không liệt kê dàn trải.
  ```
  (Bodies: short, real Vietnamese PM guidance — see plan's skill table. Identifiers +
  frontmatter keys English.)

- `src/skills/__init__.py` (empty package marker).
- `src/skills/models.py` — the `Skill` frozen dataclass (< 40 LOC).
- `src/skills/skill_loader.py` — `load_skills` + a `_parse_frontmatter` helper (< 120 LOC).
- `tests/test_skill_loader.py` — loader + profile-block tests.

## Files to Modify

- `src/profile/loader.py`:
  - Add `skills: tuple[str, ...]` to `LoadedProfile` (after `reports`, `:57`).
  - In `load_profile`, parse alongside `reports` (`:104`):
    `skills_list = yaml_doc.get("skills") or []` →
    `skills=tuple(str(s) for s in skills_list) if isinstance(skills_list, list) else ()`.
  - Update the `LoadedProfile(...)` construction (`:108`) with `skills=...`.

  Note: `loader_mapping.py` is for `Settings`/`ReportingConfig` field mapping — `skills`
  is profile METADATA (like `reports`/`schedule`), parsed DIRECTLY in `loader.py`, NOT in
  `loader_mapping.py`. Do not touch `loader_mapping.py`.

## Implementation Steps

1. `src/skills/models.py`: `@dataclass(frozen=True) class Skill` with `name: str`,
   `description: str`, `applies_to: tuple[str, ...] = ()`, `body: str`.
2. `src/skills/skill_loader.py`:
   - `_parse_frontmatter(text) -> tuple[dict, str]`: if text starts with `---`, split on
     the next `---` line; `yaml.safe_load` the frontmatter block; return `(meta, body)`.
     No frontmatter → return `({}, text)` (caller treats empty-meta as malformed → skip).
   - `load_skills(skills_dir: Path) -> list[Skill]`: for each `*.md`, read, parse, require
     `name` + `description` (else skip + `logger.warning`), coerce `applies_to` list →
     tuple, build `Skill`. Wrap each file in `try/except` so one bad file never aborts the
     scan. Return sorted-by-name for determinism.
   - `BUNDLED_SKILLS_DIR = REPO_ROOT / "skills"` (import `REPO_ROOT` from
     `src.config.settings` — verified present, `loader.py:28` imports it).
3. `src/profile/loader.py`: add the field + parse (above).
4. Tests (`tests/test_skill_loader.py`):
   - `test_load_bundled_skills_returns_five` — assert names == the 5 expected.
   - `test_skill_frontmatter_parsed` — `applies_to`/`description`/`body` populated.
   - `test_malformed_skill_skipped` — write a tmp dir with one good + one no-frontmatter +
     one bad-yaml file; assert only the good one loads (no raise).
   - `test_allowed_tools_parsed_but_ignored` — a skill with `allowed-tools` loads fine and
     the `Skill` carries NO authority field (forward-compat doc).
   - `test_profile_skills_block_parsed` — tmp profile with `skills: [flag-risk]` →
     `LoadedProfile.skills == ("flag-risk",)`.
   - `test_profile_no_skills_block_empty` — tmp profile w/o the block → `()`.
   - `test_default_profile_has_no_skills` — `load_profile("default").skills == ()`.

## Test / Validation (offline)

```
uv run pytest tests/test_skill_loader.py -q          # new file, focused
uv run pytest tests/test_profile_loader.py -q        # if exists — loader regression
uv run pytest -q                                     # full 545 green
uv run ruff check src/skills tests/test_skill_loader.py
```

No network, no LLM, no MCP — pure file IO. Use `tmp_path` for malformed-file + profile
tests; the bundled-skills test reads the real committed `skills/`.

## LOC Watch

`skill_loader.py` target < 120; `models.py` < 40. If frontmatter parsing grows, split the
parse helper into `src/skills/frontmatter.py`.

## Risks / Rollback

- **R5 (malformed file):** per-file `try/except` + warning; never raise. Test proves skip.
- **R8 (dir collision):** `skills/` is DATA loaded by path, NOT a Python package; code is
  `src/skills/`. No import of `skills/` as a module.
- **Rollback:** `git revert` — removes `src/skills/`, `skills/*.md`, the `LoadedProfile`
  field + parse. `default` had no `skills:` block, so deployments unaffected.

## Done = Observable

5 `Skill` objects load from the real `skills/` dir; a profile's `skills:` list parses to a
tuple; `default` → `()`; malformed file skipped; 545 green; ruff clean.
