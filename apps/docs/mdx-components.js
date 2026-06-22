import { useMDXComponents as getThemeComponents } from "nextra-theme-docs";

// Nextra 4 requires a top-level `useMDXComponents` so MDX pages pick up the
// docs theme's components (headings, code blocks, callouts, etc.).
const themeComponents = getThemeComponents();

export function useMDXComponents(components) {
  return {
    ...themeComponents,
    ...components,
  };
}
