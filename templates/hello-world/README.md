<p align="center">
  <img src="../../thunderbun-logo.png" alt="Thunderbun" width="100" />
</p>

# Thunderbun Hello World

A simple Thunderbun app to get you started with the framework.

## What You'll See

This hello world app demonstrates:
- **Native Window**: A cross-platform desktop window
- **Web-based UI**: Modern HTML, CSS, and JavaScript interface
- **Simple Architecture**: Clean separation between Bun process and UI

## Getting Started

1. Install dependencies:
   ```bash
   bun install
   ```

2. Run in development mode:
   ```bash
   bun run dev
   ```

3. Build for production:
   ```bash
   bun run build
   ```

## Project Structure

```
src/
├── bun/
│   └── index.ts      # Main process - creates and manages windows
└── mainview/
    ├── index.html    # Your app's UI
    ├── index.css     # Styles
    └── index.ts      # View logic
```

## Next Steps

Ready to build something more complex? Check out:

- **[GitHub](https://github.com/arbuthnot-eth/thunderbun)** — Star the repo and join the community
- **[Templates](https://github.com/arbuthnot-eth/thunderbun/tree/master/templates)** — See advanced features like ski-dapp, Svelte, and more

### Add More Features

Want to extend this app? Try adding:
- RPC communication between Bun and webview
- Native menus and system tray
- File dialogs and system integration
- Multiple windows and views
