#!/usr/bin/env bash
#
# rebuild-physx-webidl.sh — rebuild the vendored physx-js-webidl fork and
# drop the resulting artifact into third_party/physx-webidl/.
#
# We ship a prebuilt `.mjs` + `.wasm` pair in the repo so CI (and anyone
# checking out fresh) can `npm run build` without emscripten, docker, or a
# submodule checkout. This script exists so that when you want to bump to
# a newer fork commit, or verify the prebuilt artifact reproduces from
# source, you can:
#
#     ./scripts/rebuild-physx-webidl.sh [<git-ref>]
#
# With no argument the script rebuilds at the pinned commit below. Pass a
# sha, tag, or branch name to rebuild against that ref instead (useful when
# iterating on a new patch — once the new commit lands on the fork's main
# branch, bump PINNED_REF and re-run).
#
# Requirements (Mac or Linux):
#   - git
#   - docker with `docker compose` v2
#   - ~12 GB free disk for the PhysX source + docker cache
#   - ~15 min on first build; ~5 min on subsequent builds (docker layers cached)
#
# The fork (kzahel/physx-js-webidl) carries one patch on top of
# fabmax/physx-js-webidl: `SupportFunctions::PxScene_writeActiveTransforms`,
# which dumps every active actor's {ptr, pos, quat} into a HEAPF32 slab in
# one wasm call. src/engine/physics.ts feature-detects this function and
# falls back to the stock per-body getGlobalPose() loop if absent — so the
# patched build is a perf win for scenes with >1k active bodies, not a
# correctness requirement.

set -euo pipefail

PINNED_REF="${1:-7da62bb294ffd71035041a701f0f725676f0b690}"
FORK_URL="git@github.com:kzahel/physx-js-webidl.git"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/third_party/physx-webidl"
WORK_DIR="${REPO_ROOT}/.physx-build"

echo "==> Building physx-js-webidl fork"
echo "    fork:   ${FORK_URL}"
echo "    ref:    ${PINNED_REF}"
echo "    out:    ${OUT_DIR}"
echo "    scratch:${WORK_DIR}"

for bin in git docker; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "error: required tool '$bin' not on PATH" >&2
    exit 1
  fi
done
if ! docker compose version >/dev/null 2>&1; then
  echo "error: 'docker compose' v2 not available; install a modern Docker" >&2
  exit 1
fi

if [[ ! -d "${WORK_DIR}/.git" ]]; then
  echo "==> Cloning fork into scratch dir"
  git clone --recursive "${FORK_URL}" "${WORK_DIR}"
else
  echo "==> Reusing existing scratch clone at ${WORK_DIR}"
  git -C "${WORK_DIR}" fetch --all --tags
fi

echo "==> Checking out ${PINNED_REF}"
git -C "${WORK_DIR}" checkout --force "${PINNED_REF}"
git -C "${WORK_DIR}" submodule update --init --recursive

echo "==> Running docker build (this is the slow part)"
(
  cd "${WORK_DIR}"
  docker compose up --build --quiet-pull
  docker compose run --rm builder ./make.sh
)

echo "==> Verifying built artifact carries the batch patch"
if ! grep -q "PxScene_writeActiveTransforms" "${WORK_DIR}/dist/physx-js-webidl.mjs"; then
  echo "error: built .mjs does not contain PxScene_writeActiveTransforms — the patch did not apply" >&2
  echo "       (are you building an un-patched commit? expected PINNED_REF 7da62bb or later on the fork)" >&2
  exit 1
fi

echo "==> Copying artifact into ${OUT_DIR}"
mkdir -p "${OUT_DIR}"
cp "${WORK_DIR}/dist/physx-js-webidl.mjs"  "${OUT_DIR}/"
cp "${WORK_DIR}/dist/physx-js-webidl.wasm" "${OUT_DIR}/"
cp "${WORK_DIR}/LICENSE"                    "${OUT_DIR}/"
cp "${WORK_DIR}/NOTICE.md"                  "${OUT_DIR}/"

echo
echo "==> Done. New artifact at ${OUT_DIR}."
echo "    Built from ref: $(git -C "${WORK_DIR}" rev-parse HEAD)"
echo "    Review, test (npm run build && npm run preview), and commit:"
echo "      git add third_party/physx-webidl/"
echo "      git commit -m 'Bump physx-js-webidl fork to <shortsha>'"
echo
echo "    To free the ${WORK_DIR} scratch dir:  rm -rf ${WORK_DIR}"
