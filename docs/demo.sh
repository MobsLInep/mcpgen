#!/usr/bin/env bash
#
# Self-contained mcpgen demo, meant for recording an asciinema cast:
#
#   asciinema rec demo.cast -c "bash docs/demo.sh"
#   agg demo.cast docs/assets/demo.gif
#
# It uses the published CLI via `npx mcpgenx` and a throwaway OpenAPI spec, so it
# runs anywhere with Node 20+ and needs no API key (offline generation).
set -euo pipefail

CLI="npx -y mcpgenx@latest"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Pretty "typed command" prompt + small pauses so the cast reads well.
run() {
  printf '\n\033[1;32m$\033[0m \033[1m%s\033[0m\n' "$*"
  sleep 0.8
  eval "$@"
  sleep 1.4
}

cat > "$WORK/petstore.yaml" <<'YAML'
openapi: 3.0.0
info: { title: Swagger Petstore, version: 1.0.0 }
servers: [{ url: https://petstore.example.com }]
paths:
  /pets:
    get: { operationId: listPets, responses: { '200': { description: ok } } }
    post: { operationId: createPet, responses: { '201': { description: created } } }
  /pets/{petId}:
    get:
      operationId: showPetById
      parameters:
        - { name: petId, in: path, required: true, schema: { type: string } }
      responses: { '200': { description: ok } }
YAML

clear
printf '\033[1;36m# mcpgen — any API → a working MCP server\033[0m\n'
sleep 1

run "$CLI doctor"
run "$CLI inspect $WORK/petstore.yaml"
run "$CLI generate $WORK/petstore.yaml --out $WORK/petstore-mcp --offline --no-verify"
run "ls $WORK/petstore-mcp"
run "sed -n '1,12p' $WORK/petstore-mcp/src/server.ts"

printf '\n\033[1;36m# → npx mcpgenx generate <spec> --out <dir>  (drop --offline for LLM-powered generation)\033[0m\n'
sleep 2
