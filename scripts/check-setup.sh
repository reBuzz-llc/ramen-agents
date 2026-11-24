#!/bin/sh
# The setup check, under its old name: one check, one answer (python3 scripts/setup-check.py). Changes nothing.
#   sh scripts/check-setup.sh [--probe]
cd "$(dirname "$0")/.." && exec python3 scripts/setup-check.py "$@"
