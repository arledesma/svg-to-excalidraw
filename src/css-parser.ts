// Simple CSS parser for SVG styles

type CSSRule = {
  selector: string;
  declarations: Map<string, string>;
};

export class CSSParser {
  private rules: CSSRule[] = [];

  constructor(cssText: string) {
    this.parse(cssText);
  }

  private parse(cssText: string): void {
    // Remove comments
    cssText = cssText.replace(/\/\*[\s\S]*?\*\//g, "");

    // Remove @keyframes and other @ rules
    cssText = cssText.replace(/@[^{]+\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, "");

    // Match rules: selector { declarations }
    const ruleRegex = /([^{]+)\{([^}]+)\}/g;
    let match;

    while ((match = ruleRegex.exec(cssText)) !== null) {
      const selectorText = match[1].trim();
      const declarationsText = match[2].trim();

      // Split multiple selectors (e.g., "rect, circle, ellipse")
      const selectors = selectorText.split(",").map((s) => s.trim());

      const declarations = new Map<string, string>();

      // Parse declarations
      const declRegex = /([^:;]+):([^;]+)/g;
      let declMatch;

      while ((declMatch = declRegex.exec(declarationsText)) !== null) {
        const property = declMatch[1].trim();
        let value = declMatch[2].trim();

        // Strip !important flag
        value = value.replace(/\s*!important\s*$/i, "");

        declarations.set(property, value);
      }

      // Add a rule for each selector
      selectors.forEach((selector) => {
        this.rules.push({ selector, declarations });
      });
    }
  }

  // Get computed styles for an element
  getComputedStyles(element: Element): Map<string, string> {
    const computed = new Map<string, string>();

    // Apply matching rules in order
    for (const rule of this.rules) {
      if (this.matchesSelector(element, rule.selector)) {
        rule.declarations.forEach((value, property) => {
          computed.set(property, value);
        });
      }
    }

    return computed;
  }

  // Simple selector matching
  private matchesSelector(element: Element, selector: string): boolean {
    try {
      // Handle complex selectors with descendants/children
      const parts = selector.split(/\s+/);

      if (parts.length === 1) {
        // Simple selector
        return this.matchesSimpleSelector(element, parts[0]);
      }

      // Complex selector - check if element matches the last part
      // and ancestors match the previous parts
      if (!this.matchesSimpleSelector(element, parts[parts.length - 1])) {
        return false;
      }

      // Check ancestors for remaining parts (simplified - just checks if any ancestor matches)
      let currentElement: Element | null = element.parentElement;
      let partIndex = parts.length - 2;

      while (currentElement && partIndex >= 0) {
        if (this.matchesSimpleSelector(currentElement, parts[partIndex])) {
          partIndex--;
          if (partIndex < 0) return true;
        }
        currentElement = currentElement.parentElement;
      }

      return partIndex < 0;
    } catch (e) {
      return false;
    }
  }

  private matchesSimpleSelector(element: Element, selector: string): boolean {
    // Handle #id
    if (selector.startsWith("#")) {
      const id = selector.substring(1);
      return element.id === id;
    }

    // Handle .class
    if (selector.startsWith(".")) {
      const className = selector.substring(1);
      return element.classList.contains(className);
    }

    // Handle element.class
    if (selector.includes(".")) {
      const [tag, className] = selector.split(".");
      return (
        element.tagName === tag && element.classList.contains(className)
      );
    }

    // Handle element
    return element.tagName === selector;
  }
}

export function getCSSParser(root: Document): CSSParser | null {
  // Find all style tags
  const styleTags = root.querySelectorAll("style");
  if (styleTags.length === 0) return null;

  let cssText = "";
  styleTags.forEach((style) => {
    cssText += style.textContent || "";
  });

  return new CSSParser(cssText);
}
