#!/usr/bin/env bash
set -euo pipefail

for command in docker pnpm; do
  command -v "$command" >/dev/null || { echo "Missing required supply-chain command: $command" >&2; exit 1; }
done

output_dir="${SECURITY_OUTPUT_DIR:-artifacts/security}"
image="trail-security-scan:${GITHUB_SHA:-local}"
trivy_image="aquasec/trivy:0.69.3@sha256:bcc376de8d77cfe086a917230e818dc9f8528e3c852f7b1aff648949b6258d1c"
mkdir -p "$output_dir"
output_abs="$(cd "$output_dir" && pwd)"
image_tar="$(mktemp "${TMPDIR:-/tmp}/trail-api-image.XXXXXX")"
trap 'rm -f "$image_tar"' EXIT

# pnpm produces the repository-wide license inventory without sending package data to a service.
pnpm licenses list --json > "$output_abs/licenses.json"

# Every Dockerfile base is digest-pinned. Disabling pull avoids mutable tag refreshes;
# a missing base can only be fetched at the immutable digest recorded in Dockerfile.
docker build --pull=false --tag "$image" .
docker image save --output "$image_tar" "$image"
chmod 0444 "$image_tar"
docker pull "$trivy_image"

# The scanner only receives an immutable, read-only image archive. It is never granted
# control of the host daemon or a writable host mount. Reports are host-created and receive
# Trivy's stdout. The bounded tmpfs holds only Trivy's cache and other ephemeral files.
# The Node-only runtime has no JVM; transitive package test-fixture JARs are not executable
# release inputs and are skipped to avoid downloading an irrelevant Java advisory database.
trivy_runtime=(
  --rm
  --pull=never
  --user 65532:65532
  --read-only
  --cap-drop ALL
  --security-opt no-new-privileges=true
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=2g,mode=1777
  --mount "type=bind,src=$image_tar,dst=/scan/image.tar,readonly"
)
vulnerability_report="$output_abs/container-vulnerabilities.json"
sbom_report="$output_abs/container-sbom.cdx.json"
: > "$vulnerability_report"
: > "$sbom_report"

set +e
docker run "${trivy_runtime[@]}" "$trivy_image" image --input /scan/image.tar \
  --cache-dir /tmp/trivy-cache --scanners vuln --skip-files '**/*.jar' \
  --severity HIGH,CRITICAL --format json --exit-code 1 > "$vulnerability_report"
scan_status=$?
set -e
docker run "${trivy_runtime[@]}" "$trivy_image" image --input /scan/image.tar \
  --cache-dir /tmp/trivy-cache --skip-files '**/*.jar' --format cyclonedx > "$sbom_report"

printf 'License inventory: %s\nVulnerability report: %s\nContainer SBOM: %s\n' \
  "$output_dir/licenses.json" "$output_dir/container-vulnerabilities.json" \
  "$output_dir/container-sbom.cdx.json"
exit "$scan_status"
