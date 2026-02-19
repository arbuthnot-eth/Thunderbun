# Multitab Browser

A demonstration of building a multi-tab browser using ThunderBun framework.

## Features

- Multiple browser tabs with independent webviews
- Navigation controls (back, forward, refresh, home)
- URL bar with navigation
- Tab management (new, close, switch)
- Bookmark functionality
- History tracking

## Running the Demo

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev

# Build for production
bun run build
```

## Architecture

This template demonstrates:
- Using BrowserView for embedded web content
- RPC communication between main process and renderer
- Tab state management
- Keyboard shortcuts
- URL handling and navigation