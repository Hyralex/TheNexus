# TheNexus

Your personal AI mission control dashboard.

## Tech Stack

- **Runtime:** [Bun](https://bun.sh/) - Fast JavaScript runtime and package manager
- **Framework:** [Hono](https://hono.dev/) - Ultra-lightweight web framework
- **Frontend:** [HTMX](https://htmx.org/) - Dynamic interactions without JavaScript frameworks
- **Styling:** [Pico CSS](https://picocss.com/) - Minimal CSS framework

## Project Structure

```
TheNexus/
├── package.json          # Dependencies and scripts
├── bunfig.toml          # Bun configuration
├── src/
│   └── index.ts         # Hono server entry point
├── public/
│   ├── index.html       # Main dashboard
│   └── styles.css       # Custom styles
├── README.md
└── .gitignore
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) installed (`curl -fsSL https://bun.sh/install | bash`)

### Installation

```bash
# Clone the repository
git clone https://github.com/hyralexaichanbot-bot/TheNexus.git
cd TheNexus

# Install dependencies
bun install
```

### Running Locally

```bash
# Development mode (with hot reload)
bun run dev

# Production mode
bun run start
```

Server runs on `http://localhost:3000` by default.

### Environment Variables

- `PORT` - Server port (default: 3000)

```bash
PORT=8080 bun run start
```

## API Endpoints

- `GET /` - Serves the dashboard (index.html)
- `GET /api/health` - Health check endpoint (JSON)

## Features

- ✅ Static file serving from `/public`
- ✅ Health check API endpoint
- ✅ Auto-refreshing status dashboard (every 5s)
- ✅ Minimal, responsive design
- ✅ TypeScript support

## License

MIT
