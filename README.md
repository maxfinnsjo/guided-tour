# Guided Tour

A mobile web app for exploring places on foot — works as a free-roam companion or a guided itinerary.

**[Open the app →](https://maxfinnsjo.github.io/guided-tour/)**

## What it does

- **Free roam**: walks you around any area. When you get within 80m of a point of interest, a flash card surfaces automatically with info about the place.
- **Tour mode**: import a JSON or CSV list of POIs and step through them in order. The app tracks your progress and marks each stop visited as you arrive.

Each flash card shows a digest of what's worth knowing: name, type, opening hours, architect, year built, and a Wikipedia extract when available. There's also a FAQ section with the most common questions for each place.

## Usage

Open the app on your phone and allow location access. That's it for free roam. For a guided tour, tap the Tour button and import your POI file.

POI files can be JSON arrays or CSV with columns: `name`, `lat`, `lon`, and any optional tags.

## Running locally

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build → dist/
npm run preview   # preview production build
```

## Deploying

```bash
bash deploy.sh    # builds and force-pushes dist/ to the gh-pages branch
```
