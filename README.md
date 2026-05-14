# svg-to-excalidraw

Convert SVG files to Excalidraw's file format — as a library or CLI.

Particularly useful for recovering editable diagrams from Excalidraw SVG exports that have lost their embedded scene data (e.g. after being shared through services that strip metadata).

## CLI Usage

```bash
# Convert an SVG file to .excalidraw format
bun cli.ts input.svg output.excalidraw

# Or via the package script
npm run convert -- input.svg output.excalidraw

# If output is omitted, writes <input>.excalidraw alongside the input
bun cli.ts diagram.svg
```

### Supported elements

- Shapes: `rect`, `circle`, `ellipse`, `polygon`, `polyline`
- Paths: `path` (including fill rules and winding order)
- Text: `text`, `foreignObject`
- Groups: `g` (with transform accumulation)
- References: `use` / `xlink:href`
- CSS: embedded `<style>` rules, inline styles, and direct attributes

### Prerequisites

The CLI requires [Bun](https://bun.sh), [Node.js](https://nodejs.org) with [tsx](https://github.com/privatenumber/tsx), or any runtime that supports TypeScript execution.

The library must be built before running the CLI:

```bash
npm install
npm run build
```

## Library Usage

```typescript
import svgToEx from "svg-to-excalidraw";

const { hasErrors, errors, content } = svgToEx.convert(svgString);

if (hasErrors) {
  console.error(errors);
} else {
  // content is an Excalidraw-compatible JSON object
  // with { type, version, source, elements }
  console.log(JSON.stringify(content));
}
```

## Development

```bash
# Install dependencies
npm install

# Build the UMD bundle
npm run build

# Build and watch
npm run build:watch

# Type check
npm run typecheck

# Lint
npm run lint
```

## Contributing

Pull requests are welcome. For major changes, please [open an issue](https://github.com/excalidraw/svg-to-excalidraw/issues) first to discuss what you would like to change.

## License

[MIT](LICENSE)
