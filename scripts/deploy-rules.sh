#!/usr/bin/env bash
set -euo pipefail

firebase deploy --only firestore:rules --project wugi-prod
