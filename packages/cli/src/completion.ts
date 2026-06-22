/**
 * `mcpgen completion <shell>` — print a shell completion script to stdout. The
 * scripts are static (the command surface is small and stable), so completion
 * works without a runtime round-trip:
 *
 *   bash:  mcpgen completion bash >> ~/.bashrc
 *   zsh:   mcpgen completion zsh  > "${fpath[1]}/_mcpgen"
 *   fish:  mcpgen completion fish > ~/.config/fish/completions/mcpgen.fish
 */

export const COMPLETION_SHELLS = ["bash", "zsh", "fish"] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

/** Top-level subcommands offered for completion. */
const COMMANDS = [
  "info",
  "inspect",
  "generate",
  "init",
  "doctor",
  "completion",
] as const;

/** Flags offered after `generate`. */
const GENERATE_FLAGS = [
  "--out",
  "--transport",
  "--auth",
  "--model",
  "--offline",
  "--no-verify",
  "--max-repairs",
  "--json",
];

function bashScript(): string {
  return `# mcpgen bash completion
_mcpgen() {
  local cur prev words cword
  _init_completion 2>/dev/null || {
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
  }
  local commands="${COMMANDS.join(" ")}"
  if [ "\${COMP_CWORD}" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "\${commands} --help --version" -- "\${cur}") )
    return
  fi
  case "\${COMP_WORDS[1]}" in
    generate)
      case "\${prev}" in
        --transport) COMPREPLY=( $(compgen -W "stdio http" -- "\${cur}") ); return ;;
        --auth) COMPREPLY=( $(compgen -W "apikey oauth none" -- "\${cur}") ); return ;;
        -o|--out) COMPREPLY=( $(compgen -d -- "\${cur}") ); return ;;
      esac
      COMPREPLY=( $(compgen -W "${GENERATE_FLAGS.join(" ")}" -- "\${cur}") )
      ;;
    inspect) COMPREPLY=( $(compgen -W "--json" -- "\${cur}") ) ;;
    doctor) COMPREPLY=( $(compgen -W "--json" -- "\${cur}") ) ;;
    completion) COMPREPLY=( $(compgen -W "${COMPLETION_SHELLS.join(" ")}" -- "\${cur}") ) ;;
  esac
}
complete -F _mcpgen mcpgen
`;
}

function zshScript(): string {
  return `#compdef mcpgen
# mcpgen zsh completion
_mcpgen() {
  local -a commands
  commands=(
    'info:Print engine information'
    'inspect:Summarize a source'\\''s tool candidates'
    'generate:Generate an MCP server from a source'
    'init:Guided generation wizard'
    'doctor:Check the local environment'
    'completion:Print a shell completion script'
  )
  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi
  case "\${words[2]}" in
    generate)
      _arguments \\
        '(-o --out)'{-o,--out}'[output directory]:dir:_files -/' \\
        '--transport[transport]:kind:(stdio http)' \\
        '--auth[auth handling]:mode:(apikey oauth none)' \\
        '--model[Claude model id]:model:' \\
        '--offline[deterministic generation]' \\
        '--no-verify[skip verification]' \\
        '--max-repairs[max repair iterations]:n:' \\
        '--json[machine-readable output]'
      ;;
    inspect|doctor) _arguments '--json[machine-readable output]' ;;
    completion) _values 'shell' ${COMPLETION_SHELLS.join(" ")} ;;
  esac
}
_mcpgen "$@"
`;
}

function fishScript(): string {
  const cmdDescs: Record<(typeof COMMANDS)[number], string> = {
    info: "Print engine information",
    inspect: "Summarize a source's tool candidates",
    generate: "Generate an MCP server from a source",
    init: "Guided generation wizard",
    doctor: "Check the local environment",
    completion: "Print a shell completion script",
  };
  const lines = [
    "# mcpgen fish completion",
    "function __mcpgen_no_subcommand",
    "  set -l cmd (commandline -opc)",
    "  test (count $cmd) -eq 1",
    "end",
  ];
  for (const c of COMMANDS) {
    lines.push(
      `complete -c mcpgen -n __mcpgen_no_subcommand -a ${c} -d ${JSON.stringify(cmdDescs[c])}`,
    );
  }
  lines.push(
    "complete -c mcpgen -n '__fish_seen_subcommand_from generate' -l transport -a 'stdio http' -d Transport",
    "complete -c mcpgen -n '__fish_seen_subcommand_from generate' -l auth -a 'apikey oauth none' -d Auth",
    "complete -c mcpgen -n '__fish_seen_subcommand_from generate' -s o -l out -d 'Output directory' -r",
    "complete -c mcpgen -n '__fish_seen_subcommand_from generate' -l offline -d 'Deterministic generation'",
    "complete -c mcpgen -n '__fish_seen_subcommand_from generate' -l json -d 'Machine-readable output'",
    "complete -c mcpgen -n '__fish_seen_subcommand_from inspect doctor' -l json -d 'Machine-readable output'",
    `complete -c mcpgen -n '__fish_seen_subcommand_from completion' -a '${COMPLETION_SHELLS.join(" ")}' -d Shell`,
  );
  return lines.join("\n") + "\n";
}

/** Build the completion script for a shell. Throws on an unknown shell. */
export function completionScript(shell: string): string {
  switch (shell) {
    case "bash":
      return bashScript();
    case "zsh":
      return zshScript();
    case "fish":
      return fishScript();
    default:
      throw new Error(
        `unsupported shell "${shell}" (expected ${COMPLETION_SHELLS.join(", ")})`,
      );
  }
}
