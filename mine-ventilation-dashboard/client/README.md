# Mine Ventilation Monitoring Dashboard — Client

Vite + React 18 frontend for the mine ventilation monitoring research prototype.
Backend contract: `../docs/API_CONTRACT.md` (do not invent endpoints).

## Run

```bash
npm install
npm run dev      # http://localhost:5174  (proxies /api and /socket.io to :4001)
npm run build    # production build
```

The backend (`../server`) must be running on `http://localhost:4001` for live data.
Every page renders a graceful error state when the API is unreachable.

## Demo logins

| Username   | Password    | Role                |
|------------|-------------|---------------------|
| admin      | admin123    | Admin               |
| ventoff    | ventoff123  | Ventilation Officer |
| operator   | op123       | Operator            |
| viewer     | view123     | Viewer (read-only)  |

JWT is kept in memory only (never `localStorage`); refresh the page and you log in again.

## Design language

Hand-crafted industrial-mining identity: deep charcoal surfaces, signal-amber +
cyan accents, blueprint grid textures, engineering-drawing title blocks, Fraunces
serif headings with a script flourish on the brand mark, Manrope body,
JetBrains Mono for every number. Status is always colour + icon + text.

Academic prototype — not a certified mine-safety system.
