import nextra from "nextra";

const withNextra = nextra({
  // Nextra 4 reads MDX from the `content/` directory and builds the page map
  // from `_meta` files; no extra options are needed for the docs theme.
  defaultShowCopyCode: true,
});

/** @type {import('next').NextConfig} */
export default withNextra({
  reactStrictMode: true,
});
