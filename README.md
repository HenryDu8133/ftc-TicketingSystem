<!--
 * @Author: error: error: git config user.name & please set dead value or install git && error: git config user.email & please set dead value or install git & please set dead value or install git
 * @Date: 2025-10-06 09:02:55
 * @LastEditors: error: error: git config user.name & please set dead value or install git && error: git config user.email & please set dead value or install git & please set dead value or install git
 * @LastEditTime: 2025-10-06 09:47:25
 * @FilePath: \TicketMachine\README.md
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
-->
# FTC Ticketing System (English)

[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://makeapullrequest.com) [![Made with Lua](https://img.shields.io/badge/Made%20with-Lua-blue)]() [![CC:Tweaked](https://img.shields.io/badge/CC%3ATweaked-ComputerCraft-blue)](https://tweaked.cc/) [![Node.js 16+](https://img.shields.io/badge/Node.js-16%2B-green)](https://nodejs.org/) [![Open Source Love](https://img.shields.io/badge/Open%20Source-%E2%9D%A4-red)]() [![Comments: English-only](https://img.shields.io/badge/Comments-English--only-blue)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

This repository provides a ComputerCraft (CC:Tweaked) ticketing solution: a ticket machine and gates, plus a web console for managing stations, lines, fares, and ticket event logs.

Links:
- English README (this file)
- Chinese README: see `README_ZH.md`

## Features
- Ticket machine: UI, audio, printing, floppy TICKET writing, sales stats upload
- Gate: floppy-based validation, redstone control, status uploads
- Web console: manage stations/lines/fares, view ticket logs/events, insert stations mid-route
- Unique ticket IDs per sale; pre-print check (paper level and output tray reminder)

## Components
- `Lua/TicketMachine/startup.lua`: Ticket machine runtime
- `Lua/TicketMachine/gate.lua`: Gate runtime (entry/exit)
- `Lua/TicketMachine/web/server.js`: Express backend APIs
- `Lua/TicketMachine/web/main.js`: Frontend UI logic
- `Lua/TicketMachine/web/app.js`: API helpers
- `Lua/TicketMachine/web/console.js`: Console glue

## Requirements
- Minecraft with CC:Tweaked mod
- Monitor (optional), speaker, printer, and floppy drive for the machine
- Node.js 16+ for the web console

## Setup
### Ticket Machine (CC:Tweaked)
- Edit `CURRENT_STATION_CODE` in `startup.lua`
- Place peripherals: monitor (optional), speaker, printer, floppy drive
- Set `API_ENDPOINT.txt` if using a central server

### Gate (CC:Tweaked)
- Edit `CURRENT_STATION_CODE` and `GATE_TYPE` (0=entry, 1=exit) in `gate.lua`
- Place monitor, speaker, floppy drive; wire redstone to doors

### Web Console
- Install dependencies and start the server
- Configure data in `web/data/*.json` or via the UI

## Usage
- Machine: select stations, type, trips; pay -> paper check -> print -> disk write
- Gate: insert floppy; system validates and drives doors; multi-trip tickets auto-eject
- Console: manage stations/lines/fares; shift-click a segment to insert a station

## Development
- Keep comments concise and English-only for open source
- Lua: avoid blocking where possible; use `pcall` around peripherals
- Web: APIs under `/api`; data persists in `web/data/*`

## Contributing
- Submit issues and PRs; keep changes minimal and focused
- Follow existing code style and file layout

## License
- MIT License; see `LICENSE`

## Installation & Run

**Prerequisites**
- Install `Node.js 16+` (18+ recommended)

**Install dependencies**
- At repo root: `npm install`

**Start the Web Console**
- Option A (from root): `node web/server.js`
- Option B (from subdir): `cd web && node server.js`
- Default URL: `http://localhost:23333/` (override with `HOST` and `PORT` env)

**First-time setup**
- Open “System Settings” and set `API Base` (defaults to same-origin `/api`).
- Alternatively edit `web/data/config.json` and set `api_base`.

**Import/Export data**
- Use “Import Data / Export Data” buttons in the console UI; export file is `ftc-ticket-admin-backup.json`.

**Device deployment (CC:Tweaked)**
- Ticket machine: place `Lua/TicketMachine/startup.lua` as startup program and set `CURRENT_STATION_CODE`; place peripherals (monitor optional), speaker, printer, floppy drive.
- Gate: deploy `Lua/TicketMachine/gate.lua`, set `CURRENT_STATION_CODE` and `GATE_TYPE` (0=entry, 1=exit), wire redstone to doors.
- Central server: configure device-side API base (e.g., via `API_ENDPOINT.txt` or in-program config).