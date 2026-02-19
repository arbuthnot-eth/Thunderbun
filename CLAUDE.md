# Claude Development Guidelines for ThunderBun

## Building and Running ThunderBun

### IMPORTANT: Build Commands

**NEVER** run thunderbun directly from the bin folder or node_modules. The correct way to build and run ThunderBun is:

1. **From the package folder** (`/home/yoav/code/thunderbun/package/`):
   - `bun dev` - Builds and runs the kitchen app in dev mode
   - `bun dev:canary` - Builds the kitchen app in canary mode

2. **Build Process Flow**:
   - Always run build commands from the `package` folder
   - The build process will automatically:
     - Build the native wrappers
     - Compile the TypeScript code
     - Build the CLI
     - Switch to the kitchen folder and build/run the app

## Project Structure

- `/package` - Main ThunderBun package source
- `/kitchen` - Test application (Kitchen Sink)
- `/package/src/cli` - CLI implementation
- `/package/src/extractor` - Self-extractor implementation (Zig)
- `/package/src/native` - Native wrappers for each platform
- `/templates/sui-twa` - Sui TWA template (dApp Kit + WaaP + ecosystem SDKs)

## CRITICAL: Sui RPC Deprecation Timeline

**JSON-RPC is being sunset.** Do NOT write new code using JSON-RPC unless there is no alternative.

| Date | Milestone |
|------|-----------|
| Sep–Oct 2025 | JSON-RPC enters deprecation |
| Dec 2025 | GraphQL RPC + Indexer reach GA |
| **April 2026** | **JSON-RPC shuts down entirely** |

### Migration Priority

1. **gRPC** (`SuiGrpcClient` from `@mysten/sui/grpc`) — replaces JSON-RPC on full nodes, generally available NOW. Use for all new direct node communication. Public endpoints: `https://fullnode.{mainnet,testnet,devnet}.sui.io:443`
2. **GraphQL RPC** (`SuiGraphQLClient` from `@mysten/sui/graphql`) — alternative to gRPC, better for complex queries. Requires self-hosted or provider-hosted GraphQL+Indexer stack.
3. **JSON-RPC** (`SuiJsonRpcClient` from `@mysten/sui/jsonRpc`) — DEPRECATED. Only use as fallback when ecosystem SDKs require it.

### Current state (sui-twa template)

- `dapp-kit.ts` uses `SuiGrpcClient` from `@mysten/sui/grpc`. All Mysten ecosystem SDKs (`dapp-kit-core`, `deepbook-v3`, `seal`, `walrus`, `suins`) accept `ClientWithCoreApi` and are fully compatible with gRPC.
- `@human.tech/waap-sdk@1.2.0` and `@ika.xyz/sdk@0.2.7` are still pinned to `@mysten/sui@^1.x` (both at latest published versions). This does not affect the main client — WaaP only does Wallet Standard registration (client-agnostic), and Ika creates its own isolated JSON-RPC client via dynamic import.
- The `@ika.xyz/sdk` bundles its own `@mysten/sui@1.45.2` (pre-v2) and expects `SuiClient` (alias for `SuiJsonRpcClient`). Pass via `as never` for type compatibility.

## Sui TWA Template: SDK Client Architecture

- `src/sui-client.ts` provides lazy, network-aware singletons for SealClient, DeepBookClient, WalrusClient
- All clients auto-invalidate on network switch
- DeepBook uses `address: "0x0"` for read-only queries; real address needed for order execution
- Seal key servers are only configured for testnet; `getSealClient()` returns null on other networks
- Walrus SDK `writeBlob()` requires a `Signer` keypair (not available in browser wallet context); use HTTP publisher for writes, SDK for reads
