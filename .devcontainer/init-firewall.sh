#!/bin/bash
# Default-deny egress firewall for the Claude Code devcontainer.
# Adapted from anthropics/claude-code .devcontainer/init-firewall.sh.
#
# Policy (which hosts are reachable) lives in /etc/devcontainer/allowed-domains.txt,
# baked into the image root-owned: changing it requires an image rebuild, so
# nothing running inside the container can widen its own network access.
# Mechanism (this script) resolves that policy into an ipset + iptables rules.
#
# Directives supported in the domains file:
#   @github-meta   - allow GitHub's published web/api/git CIDR ranges
#   @google-cidrs  - allow Google's published IPv4 ranges (goog.json)
set -euo pipefail
IFS=$'\n\t'

DOMAINS_FILE=/etc/devcontainer/allowed-domains.txt

# Preserve Docker's embedded-DNS NAT rules before flushing anything.
DOCKER_DNS_RULES=$(iptables-save -t nat | grep "127\.0\.0\.11" || true)

# Reset to a permissive baseline so re-runs inside a live container work
# (flushing rules does not reset chain policies from a previous run).
iptables -P INPUT ACCEPT
iptables -P FORWARD ACCEPT
iptables -P OUTPUT ACCEPT
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
ipset destroy allowed-domains 2>/dev/null || true

if [ -n "$DOCKER_DNS_RULES" ]; then
    echo "Restoring Docker DNS rules..."
    iptables -t nat -N DOCKER_OUTPUT 2>/dev/null || true
    iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
    echo "$DOCKER_DNS_RULES" | xargs -L 1 iptables -t nat
fi

# DNS, outbound SSH, loopback: needed before any lockdown.
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A INPUT -p udp --sport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT
iptables -A INPUT -p tcp --sport 22 -m state --state ESTABLISHED -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

ipset create allowed-domains hash:net

add_cidr() {
    local cidr="$1" label="$2"
    if [[ ! "$cidr" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(/[0-9]{1,2})?$ ]]; then
        echo "ERROR: invalid IP/CIDR from $label: $cidr"
        exit 1
    fi
    ipset add allowed-domains "$cidr" -exist
}

fetch_github_meta() {
    echo "Fetching GitHub IP ranges..."
    local meta
    meta=$(curl -fsS https://api.github.com/meta)
    echo "$meta" | jq -e '.web and .api and .git' >/dev/null \
        || { echo "ERROR: GitHub meta response missing required fields"; exit 1; }
    while read -r cidr; do
        add_cidr "$cidr" "github-meta"
    done < <(echo "$meta" | jq -r '(.web + .api + .git)[]' | grep -v ':' | aggregate -q)
}

fetch_google_cidrs() {
    echo "Fetching Google IP ranges..."
    local goog
    goog=$(curl -fsS https://www.gstatic.com/ipranges/goog.json)
    echo "$goog" | jq -e '.prefixes' >/dev/null \
        || { echo "ERROR: goog.json response missing prefixes"; exit 1; }
    while read -r cidr; do
        add_cidr "$cidr" "google-cidrs"
    done < <(echo "$goog" | jq -r '.prefixes[].ipv4Prefix // empty' | aggregate -q)
}

resolve_domain() {
    local domain="$1"
    echo "Resolving $domain..."
    local ips
    ips=$(dig +noall +answer A "$domain" | awk '$4 == "A" {print $5}')
    [ -n "$ips" ] || { echo "ERROR: failed to resolve $domain"; exit 1; }
    while read -r ip; do
        add_cidr "$ip" "$domain"
    done < <(echo "$ips")
}

[ -f "$DOMAINS_FILE" ] || { echo "ERROR: $DOMAINS_FILE not found"; exit 1; }
while read -r line; do
    entry="${line%%#*}"
    entry="$(echo "$entry" | tr -d '[:space:]')"
    [ -z "$entry" ] && continue
    case "$entry" in
        @github-meta)  fetch_github_meta ;;
        @google-cidrs) fetch_google_cidrs ;;
        @*)            echo "ERROR: unknown directive $entry"; exit 1 ;;
        *)             resolve_domain "$entry" ;;
    esac
done < "$DOMAINS_FILE"

# Allow the container's local bridge network (host <-> container traffic,
# including docker-proxy for compose-published ports such as Postgres 5432).
HOST_IP=$(ip route | grep default | cut -d" " -f3)
[ -n "$HOST_IP" ] || { echo "ERROR: failed to detect host IP"; exit 1; }
HOST_NETWORK=$(echo "$HOST_IP" | sed "s/\.[0-9]*$/.0\/24/")
echo "Host network detected as: $HOST_NETWORK"
iptables -A INPUT -s "$HOST_NETWORK" -j ACCEPT
iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT

iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT
# REJECT (not DROP) so blocked calls fail fast with a clear error.
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

echo "Firewall configuration complete"
echo "Verifying firewall rules..."
if curl --connect-timeout 5 -s https://example.com >/dev/null 2>&1; then
    echo "ERROR: verification failed - able to reach https://example.com"
    exit 1
else
    echo "Verification passed - example.com blocked as expected"
fi
if ! curl --connect-timeout 10 -s https://api.anthropic.com >/dev/null 2>&1; then
    echo "ERROR: verification failed - unable to reach https://api.anthropic.com"
    exit 1
else
    echo "Verification passed - api.anthropic.com reachable as expected"
fi
