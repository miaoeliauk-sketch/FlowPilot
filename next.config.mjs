const nextConfig = {
  // Keep the development server cache separate from production builds.
  // Otherwise running `next build` while `next dev` is open can leave the
  // browser requesting chunks and styles that the build has replaced.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
};

export default nextConfig;
