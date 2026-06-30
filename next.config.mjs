/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Disable Turbopack so Tailwind v3 PostCSS runs correctly in dev
  turbopack: {
    enabled: false,
  },
}

export default nextConfig
