# Food Order Monorepo

This version is arranged for GitHub and Render:

## Folders
- `frontend/` -> HTML, CSS, JS, config
- `backend/` -> Express server, uploads, orders, package.json

## GitHub
Upload the whole folder to one repo.

## Render
Use the repo root and keep `render.yaml`.
Render will pick:
- `rootDir: backend`
- `buildCommand: npm install`
- `startCommand: npm start`

## Edit these
### frontend/config.js
- business name
- branches
- branch WhatsApp numbers
- branch bank accounts
- menu items

### backend/server-config.js
- business name

## Local run
Open terminal inside `backend` folder:
```bash
npm install
npm start
```

Then open:
```bash
http://localhost:3000
```
