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
    users)           echo "list add remove" ;;
    namespaces)      echo "list create rename delete sessions assign-session add-user remove-user set-limits" ;;
    sessions)        echo "list nuke seed" ;;
    metrics)         echo "" ;;
    invite-requests) echo "list clear" ;;
    *)               echo "" ;;
  esac
}

# Subcommands that support --json / -j output
_dnd_supports_json() {
  case "$1/$2" in
    users/list|namespaces/list|namespaces/sessions|sessions/list|metrics/|invite-requests/list) return 0 ;;
    *) return 1 ;;
  esac
}

_dnd_complete() {
  local cur resource subcommand i word
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
    COMPREPLY=($(compgen -W "users namespaces sessions metrics invite-requests" -- "$cur"))
  elif [[ -z "$subcommand" ]]; then
    # shellcheck disable=SC2207
    COMPREPLY=($(compgen -W "$(_dnd_subcommands "$resource")" -- "$cur"))
  elif _dnd_supports_json "$resource" "$subcommand"; then
    # shellcheck disable=SC2207
    COMPREPLY=($(compgen -W "--json -j" -- "$cur"))
  fi
}

complete -F _dnd_complete dnd-fam-ftw-cli
complete -F _dnd_complete dnd-fam-ftw-prod-cli
