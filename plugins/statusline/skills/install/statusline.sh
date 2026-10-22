#!/usr/bin/env bash
# Claude Code status line. Shortens the directory when the line would overflow.
# MASTER COPY: installed to ~/.claude/ by /statusline:install.
# If you change your status line, update this file too (see SKILL.md).

input=$(cat)

field() { echo "$input" | sed -n "s/.*\"$1\": *\"\\([^\"]*\\)\".*/\\1/p"; }

dir=$(field current_dir | sed 's#[\\/][\\/]*#/#g')
model=$(field display_name)
branch=$(git -C "$dir" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null)
five=$(echo "$input" | sed -n 's/.*"five_hour": *{[^}]*"used_percentage": *\([0-9.]*\).*/\1/p')
week=$(echo "$input" | sed -n 's/.*"seven_day": *{[^}]*"used_percentage": *\([0-9.]*\).*/\1/p')
ctx=$(echo "$input" | sed 's/.*"context_window": *{//; s/"remaining_percentage".*//' | sed -n 's/.*"used_percentage": *\([0-9.]*\).*/\1/p')

fi=$(printf '\xef\x81\xbb')
gi=$(printf '\xee\x82\xa0')

# Terminal width: $COLUMNS, then the controlling tty, then a safe default
width=${COLUMNS:-}
[ -z "$width" ] && width=$(stty size 2>/dev/null </dev/tty | cut -d' ' -f2)
[ -z "$width" ] && width=$(tput cols 2>/dev/null </dev/tty)
case "$width" in '' | *[!0-9]*) width=120 ;; esac
width=$((width - 4)) # margin for the UI's own padding

# Everything except the directory
tail=""
[ -n "$branch" ] && tail="$tail | $gi $branch"
tail="$tail | $model"
[ -n "$ctx" ] && tail="$tail | ctx $(printf '%.0f' "$ctx")%"
[ -n "$five" ] && tail="$tail | session: $(printf '%.0f' "$five")%"
[ -n "$week" ] && tail="$tail | week: $(printf '%.0f' "$week")%"

# Characters, not bytes (the icons are multibyte)
chars() { printf '%s' "$1" | wc -m | tr -d ' '; }

# Space left for the directory: line width minus "<icon> " and the tail
avail=$((width - $(chars "$fi ") - $(chars "$tail")))

# Shorten $1 to fit within $2 chars: ~ for home, then abbreviate leading
# components to their first letter (left to right), then ellipsize the front.
shorten_path() {
    local p=$1 max=$2
    [ -n "$HOME" ] && p=${p/#"$(echo "$HOME" | sed 's#\\#/#g')"/\~}
    [ "$(chars "$p")" -le "$max" ] && { printf '%s' "$p"; return; }

    local IFS=/ parts i n
    read -ra parts <<<"$p"
    n=${#parts[@]}
    for ((i = 0; i < n - 1; i++)); do
        [ -z "${parts[i]}" ] || [ "${parts[i]}" = "~" ] && continue
        [[ "${parts[i]}" =~ ^[A-Za-z]:$ ]] && continue
        parts[i]=${parts[i]:0:1}
        p="${parts[*]}"
        [ "$(chars "$p")" -le "$max" ] && { printf '%s' "$p"; return; }
    done

    # Still too long: keep the tail end
    printf '…%s' "${p: -$((max - 1))}"
}

[ "$avail" -lt 10 ] && avail=10
dir=$(shorten_path "$dir" "$avail")

echo "$fi $dir$tail"
