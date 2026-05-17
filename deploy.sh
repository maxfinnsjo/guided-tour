#!/usr/bin/env bash
set -e

npm run build
cd dist
git init
git add -A
git commit -m "deploy"
git push -f https://github.com/maxfinnsjo/guided-tour.git HEAD:gh-pages
cd ..
rm -rf dist/.git
