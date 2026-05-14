# svg-to-excalidraw

Convert SVG files to Excalidraw's file format — as a library or CLI.

Particularly useful for recovering editable diagrams from Excalidraw SVG exports that have lost their embedded scene data (e.g. after being shared through services that strip metadata).

## CLI Usage

```bash
# Build first (one-time)
npm install
npm run build

# Convert an SVG file to .excalidraw format
npm run convert -- input.svg output.excalidraw

# If output is omitted, writes <input>.excalidraw alongside the input
npm run convert -- diagram.svg
```

Any package manager works — `npm`, `yarn`, `pnpm`, or `bun`.

### Supported elements

- Shapes: `rect`, `circle`, `ellipse`, `polygon`, `polyline`
- Paths: `path` (including fill rules and winding order)
- Text: `text`, `foreignObject`
- Groups: `g` (with transform accumulation)
- References: `use` / `xlink:href`
- CSS: embedded `<style>` rules, inline styles, and direct attributes

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
npm install
npm run build        # Build CJS + ESM bundles via esbuild
npm run build:watch  # Build and watch for changes
npm run typecheck    # Type check
npm run lint         # Lint
npm run format:check # Check formatting
```

## Contributing

Pull requests are welcome. For major changes, please [open an issue](https://github.com/excalidraw/svg-to-excalidraw/issues) first to discuss what you would like to change.

## License

[MIT](LICENSE)
