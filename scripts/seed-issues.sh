#!/usr/bin/env bash
#
# Seed the mcpgen repo with its label set and a starter batch of
# `good first issue`s. Idempotent: re-running updates labels and skips issues
# whose exact title already exists.
#
# Requires the GitHub CLI (`gh auth login`). Run from the repo root:
#
#   ./scripts/seed-issues.sh
#
set -euo pipefail

REPO="${MCPGEN_REPO:-MobsLInep/mcpgen}"
echo "Seeding labels + good-first-issues on $REPO"

ensure_label() {
  local name="$1" color="$2" desc="$3"
  if gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" >/dev/null 2>&1; then
    echo "  + label: $name"
  else
    gh label edit "$name" --repo "$REPO" --color "$color" --description "$desc" >/dev/null 2>&1 || true
    echo "  ~ label: $name (updated)"
  fi
}

# A useful subset of .github/labels.yml needed by the seeded issues.
ensure_label "good first issue" "7057ff" "Good for newcomers — scoped and well described."
ensure_label "help wanted"      "008672" "Extra attention is wanted."
ensure_label "documentation"    "0075ca" "Improvements or additions to docs."
ensure_label "enhancement"      "a2eeef" "New feature or request."
ensure_label "area: cli"        "fbca04" "The mcpgen command-line interface."
ensure_label "area: core"       "fbca04" "The generation engine (packages/core)."
ensure_label "area: docs"       "fbca04" "Documentation site."
ensure_label "area: templates"  "fbca04" "Generated MCP server templates."

create_issue() {
  local title="$1" labels="$2" body="$3"
  if gh issue list --repo "$REPO" --state all --search "in:title \"$title\"" --json title \
      --jq '.[].title' 2>/dev/null | grep -Fxq "$title"; then
    echo "  = issue exists: $title"
    return
  fi
  gh issue create --repo "$REPO" --title "$title" --label "$labels" --body "$body" >/dev/null
  echo "  + issue: $title"
}

GFI="good first issue"

create_issue \
  "docs: add a 'connect to Claude Desktop' GIF to the connect guide" \
  "$GFI,documentation,area: docs" \
  $'**Good first issue.**\n\nThe [connect guide](apps/docs/content/connect.mdx) explains the config JSON but has no visual. Record a short clip of editing `claude_desktop_config.json`, restarting, and seeing the tools appear, and embed it.\n\n**Where:** `apps/docs/content/connect.mdx`, asset under `docs/assets/`.\n**Done when:** the guide shows the GIF and the docs site still builds (`pnpm --filter @mcpgen/docs build`).\n**Good to know:** no code changes; just MDX + an image.'

create_issue \
  "cli: add a --version-check that warns when a newer mcpgen is on npm" \
  "$GFI,enhancement,area: cli" \
  $'**Good first issue.**\n\nAdd an opt-in check that compares the running CLI version against the latest on npm and prints a friendly hint when out of date (respect `--json` and a `MCPGEN_NO_UPDATE_CHECK` env var).\n\n**Where:** `packages/cli/src/ui.ts` (presentation) + wire into `packages/cli/src/program.ts`.\n**Done when:** a unit test covers the up-to-date and out-of-date branches; no network call in tests (inject the fetch).\n**Good to know:** keep network logic out of `packages/core`.'

create_issue \
  "core: support YAML anchors in OpenAPI inputs (add a fixture + test)" \
  "$GFI,area: core" \
  $'**Good first issue.**\n\nConfirm OpenAPI specs that use YAML anchors/aliases parse correctly, and lock it in with a fixture.\n\n**Where:** add a fixture under `packages/core/test/fixtures/` and a case in the OpenAPI parser tests.\n**Done when:** `pnpm test` covers an anchor-using spec producing the expected IR.\n**Good to know:** parsing is deterministic and LLM-free — see `packages/core/src/parsers/openapi.ts`.'

create_issue \
  "templates: include a .editorconfig in generated servers" \
  "$GFI,enhancement,area: templates" \
  $'**Good first issue.**\n\nGenerated servers ship with Prettier-friendly code but no `.editorconfig`. Add one to the template set so the output is consistent in any editor.\n\n**Where:** `packages/templates/files/` (+ register it in `packages/core/src/generate/assemble.ts`).\n**Done when:** `engine.test.ts` asserts `.editorconfig` is present in the generated file map.\n**Good to know:** look at how `.dockerignore` is emitted for the pattern to copy.'

create_issue \
  "docs: write a 'troubleshooting' page (common errors → fixes)" \
  "$GFI,documentation,area: docs,help wanted" \
  $'**Good first issue.**\n\nCollect the most common failure modes (missing `MCPGEN_API_BASE_URL`, no `ANTHROPIC_API_KEY`, verify failures, port already in use) into a single troubleshooting page with copy-paste fixes.\n\n**Where:** new `apps/docs/content/troubleshooting.mdx` + an entry in `apps/docs/content/_meta.js`.\n**Done when:** the page is linked in the nav and the docs site builds.\n**Good to know:** mirror the friendly-error messages in `packages/cli/src/ui.ts`.'

echo "Done. View issues: gh issue list --repo $REPO --label \"$GFI\""
