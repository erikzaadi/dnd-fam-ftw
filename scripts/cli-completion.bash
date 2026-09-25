# dnd-fam-ftw CLI bash/zsh completion
#
# Source this file in your shell profile:
#   source /path/to/dnd-fam-ftw/scripts/cli-completion.bash
#
# For zsh, load bashcompinit first if not already active:
#   autoload -Uz bashcompinit && bashcompinit
#   source /path/to/dnd-fam-ftw/scripts/cli-completion.bash

_dnd_subcommands() {
  case "$1" in
    users)           echo "list add remove set-primary" ;;
    namespaces)      echo "list create rename delete sessions assign-session add-user remove-user set-limits tier" ;;
    sessions)        echo "list nuke seed export import" ;;
    metrics)         echo "usage narration" ;;
    invite-requests) echo "list approve clear" ;;
    email-outbox)    echo "list retry send-test" ;;
    limit-requests)  echo "list approve deny" ;;
    donations)       echo "list" ;;
    *)               echo "" ;;
  esac
}

# Subcommands that support --json / -j output
_dnd_supports_json() {
  case "$1/$2" in
    users/list|namespaces/list|namespaces/sessions|sessions/list|metrics/|metrics/usage|metrics/narration|invite-requests/list|email-outbox/list|limit-requests/list|donations/list) return 0 ;;
    *) return 1 ;;
  esac
}

# Flags available for each resource/subcommand
_dnd_flags() {
  case "$1/$2" in
    sessions/export)  echo "--session= --namespace= --output=" ;;
    sessions/import)  echo "--namespace-id=" ;;
    metrics/)           echo "--since=" ;;
    metrics/usage)     echo "--since= --namespace=" ;;
    metrics/narration) echo "--format= --csv --failed-only --namespace= --session= --since=" ;;
    namespaces/set-limits) echo "--max-sessions= --max-turns=" ;;
    invite-requests/approve) echo "--namespace=" ;;
    email-outbox/list) echo "--status=" ;;
    limit-requests/list) echo "--status=" ;;
    limit-requests/approve) echo "--tier=" ;;
    donations/list) echo "--outcome= --since=" ;;
    *) echo "" ;;
  esac
}

_dnd_complete() {
  local cur resource subcommand i word flags
  cur="${COMP_WORDS[COMP_CWORD]}"
  resource=""
  subcommand=""

  for ((i = 1; i < COMP_CWORD; i++)); do
    word="${COMP_WORDS[$i]}"
    if [[ "$word" != -* && "$word" != "--" ]]; then
      if [[ -z "$resource" ]]; then
        resource="$word"
      elif [[ -z "$subcommand" ]]; then
        subcommand="$word"
      fi
    fi
  done

  if [[ -z "$resource" ]]; then
    # shellcheck disable=SC2207
    COMPREPLY=($(compgen -W "users namespaces sessions metrics invite-requests limit-requests email-outbox donations" -- "$cur"))
  elif [[ -z "$subcommand" ]]; then
    # shellcheck disable=SC2207
    COMPREPLY=($(compgen -W "$(_dnd_subcommands "$resource")" -- "$cur"))
  else
    flags=""
    if _dnd_supports_json "$resource" "$subcommand"; then
      flags="--json -j"
    fi
    flags="$flags $(_dnd_flags "$resource" "$subcommand")"
    if [[ -n "${flags// }" ]]; then
      # shellcheck disable=SC2207
      COMPREPLY=($(compgen -W "$flags" -- "$cur"))
    elif [[ "$resource/$subcommand" == "sessions/import" ]]; then
      # complete filenames for import
      # shellcheck disable=SC2207
      COMPREPLY=($(compgen -f -- "$cur"))
    fi
  fi
}

complete -F _dnd_complete dnd-fam-ftw-cli
complete -F _dnd_complete dnd-fam-ftw-prod-cli
