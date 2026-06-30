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
  experimental: {
    turbo: {
      rules: {
        "*.css": {
          loaders: ["postcss-loader"],
          as: "*.css",
        },
      },
    },
  },
}

export default nextConfig
